// @flow
import type {
  ParcelConfig,
  FilePath,
  Glob,
  Transformer,
  Resolver,
  Bundler,
  Namer,
  Runtime,
  EnvironmentContext,
  PackageName,
  Packager,
  Optimizer
} from '@parcel/types';
import localRequire from '@parcel/utils/localRequire';
import {isMatch} from 'micromatch';
import {basename} from 'path';
import {CONFIG} from '@parcel/plugin';

type Pipeline = Array<PackageName>;
type GlobMap<T> = {[Glob]: T};

export default class Config {
  configPath: FilePath;
  resolvers: Pipeline;
  transforms: GlobMap<Pipeline>;
  loaders: GlobMap<PackageName>;
  bundler: PackageName;
  namers: Pipeline;
  packagers: GlobMap<PackageName>;
  optimizers: GlobMap<Pipeline>;
  reporters: Pipeline;

  constructor(config: ParcelConfig, filePath: FilePath) {
    this.configPath = filePath;
    this.resolvers = config.resolvers || [];
    this.transforms = config.transforms || {};
    this.loaders = config.loaders || {};
    this.bundler = config.bundler || '';
    this.namers = config.namers || [];
    this.packagers = config.packagers || {};
    this.optimizers = config.optimizers || {};
    this.reporters = config.reporters || [];
  }

  async loadPlugin(pluginName: PackageName) {
    let plugin = await localRequire(pluginName, this.configPath);
    plugin = plugin.default ? plugin.default : plugin;
    return plugin[CONFIG];
  }

  async loadPlugins(plugins: Pipeline) {
    return Promise.all(plugins.map(pluginName => this.loadPlugin(pluginName)));
  }

  async getResolvers(): Promise<Array<Resolver>> {
    if (this.resolvers.length === 0) {
      throw new Error('No resolver plugins specified in .parcelrc config');
    }

    return this.loadPlugins(this.resolvers);
  }

  async getTransformers(filePath: FilePath): Promise<Array<Transformer>> {
    let transformers: Pipeline | null = this.matchGlobMapPipelines(
      filePath,
      this.transforms
    );
    if (!transformers || transformers.length === 0) {
      throw new Error(`No transformers found for "${filePath}".`);
    }

    return this.loadPlugins(transformers);
  }

  async getBundler(): Promise<Bundler> {
    if (!this.bundler) {
      throw new Error('No bundler specified in .parcelrc config');
    }

    return this.loadPlugin(this.bundler);
  }

  async getNamers(): Promise<Array<Namer>> {
    if (this.namers.length === 0) {
      throw new Error('No namer plugins specified in .parcelrc config');
    }

    return this.loadPlugins(this.namers);
  }

  async getRuntimes(context: EnvironmentContext): Promise<Array<Runtime>> {
    let runtimes = this.config.runtimes[context];
    if (!runtimes) {
      return [];
    }

    return await this.loadPlugins(runtimes);
  }

  async getPackager(filePath: FilePath): Promise<Packager> {
    let packagerName: ?PackageName = this.matchGlobMap(
      filePath,
      this.packagers
    );
    if (!packagerName) {
      throw new Error(`No packager found for "${filePath}".`);
    }

    return await this.loadPlugin(packagerName);
  }

  async getOptimizers(filePath: FilePath): Promise<Array<Optimizer>> {
    let optimizers: ?Pipeline = this.matchGlobMapPipelines(
      filePath,
      this.optimizers
    );
    if (!optimizers) {
      return [];
    }

    return await this.loadPlugins(optimizers);
  }

  matchGlobMap(filePath: FilePath, globMap: {[Glob]: any}) {
    for (let pattern in globMap) {
      if (isMatch(filePath, pattern) || isMatch(basename(filePath), pattern)) {
        return globMap[pattern];
      }
    }

    return null;
  }

  matchGlobMapPipelines(filePath: FilePath, globMap: {[Glob]: Pipeline}) {
    let matches = [];
    for (let pattern in globMap) {
      if (isMatch(filePath, pattern) || isMatch(basename(filePath), pattern)) {
        matches.push(globMap[pattern]);
      }
    }

    let flatten = () => {
      let pipeline = matches.shift() || [];
      let restIndex = pipeline.indexOf('...');
      if (restIndex >= 0) {
        pipeline = [
          ...pipeline.slice(0, restIndex),
          ...flatten(),
          ...pipeline.slice(restIndex + 1)
        ];
      }

      if (pipeline.includes('...')) {
        throw new Error(
          'Only one rest parameter can be included in a config pipeline'
        );
      }

      return pipeline;
    };

    let res = flatten();
    return res;
  }
}