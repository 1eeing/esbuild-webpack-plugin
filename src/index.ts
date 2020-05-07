import os from 'os';
//@ts-ignore
import { ModuleFilenameHelpers, Compiler, compilation, util, compiler } from 'webpack';
import { RawSource } from 'webpack-sources';
import serialize from 'serialize-javascript';
import pLimit from 'p-limit';
import Worker from 'jest-worker';

import { minify as minifyFn, ensureService } from './minify';
import pkg from '../package.json';
import { Options, Task } from './types';

const getAvailableNumberOfCores = (parallel: boolean | number) => {
  // In some cases cpus() returns undefined
  // https://github.com/nodejs/node/issues/19022
  const cpus = os.cpus() || { length: 1 };

  return parallel === true
    ? cpus.length - 1
    : Math.min(Number(parallel) || 0, cpus.length - 1);
}

const buildError = (error, file) => {
  if (error.line) {
    return new Error(
      `${file} from ESBuild\n${error.message} [${file}:${error.line},${
        error.col
      }]${
        error.stack ? `\n${error.stack.split('\n').slice(1).join('\n')}` : ''
      }`
    );
  }

  if (error.stack) {
    return new Error(`${file} from ESBuild\n${error.stack}`);
  }

  return new Error(`${file} from ESBuild\n${error.message}`);
}

const buildWarning = (
  warning,
) => {
  let warningMessage = warning;
  let locationMessage = '';

  return `ESBuild Plugin: ${warningMessage}${locationMessage}`;
}

export default class ESBuildPlugin {
  private cache: any
  private options: Options
  private getTaskForAsset: any

  constructor(options: Partial<Options> = {}) {
    const {
      parallel = true,
      cache = true,
    } = options;

    this.options = {
      parallel,
      cache,
    }
  }

  async optimizeFn(compiler: Compiler ,compilation: compilation.Compilation, chunksOrAssets: any[]) {
    const matchObject = ModuleFilenameHelpers.matchObject.bind(undefined, {});
    const assetNames = [
      ...(compilation.additionalChunkAssets || []),
      ...chunksOrAssets.reduce(
        (acc, chunk) => acc.concat(Array.from(chunk.files || [])),
        []
      )
    ].filter(matchObject).filter(file => /\.m?js(\?.*)?$/i.test(file));

    if (!assetNames.length) {
      return Promise.resolve();
    }

    const CacheEngine = require('./cache').default;

    this.cache = new CacheEngine(compilation, {
      cache: this.options.cache,
    });

    this.getTaskForAsset = this.taskGenerator.bind(
      this,
      compiler,
      compilation,
    );

    await this.runTasks(assetNames);

    return Promise.resolve();
  }

  *taskGenerator(compiler: Compiler, compilation: compilation.Compilation, file: string) {
    const assetSource = compilation.assets[file];

    let input = assetSource.source();
    let inputSourceMap = null;

    // Handling comment extraction
    let commentsFilename = false;

    const callback = (taskResult) => {
      let { code } = taskResult;
      const { error, warnings, extractedComments } = taskResult;

      if (error) {
        compilation.errors.push(
          buildError(
            error,
            file,
          )
        );

        return;
      }

      const hasExtractedComments =
        commentsFilename && extractedComments && extractedComments.length > 0;

      let outputSource;

      if (
        hasExtractedComments &&
        code.startsWith('#!')
      ) {
        const firstNewlinePosition = code.indexOf('\n');

        code = code.substring(firstNewlinePosition + 1);
      }

      outputSource = new RawSource(code);

      // Updating assets
      compilation.assets[file] = outputSource;

      if (warnings && warnings.length > 0) {
        warnings.forEach((warning) => {
          const builtWarning = buildWarning(
            warning,
          );

          if (builtWarning) {
            compilation.warnings.push(builtWarning);
          }
        });
      }
    };

    const task: Task = {
      file,
      input,
      inputSourceMap,
      commentsFilename,
      callback,
    };

    const {
      outputOptions: { hashSalt, hashDigest, hashDigestLength, hashFunction },
    } = compilation;
    const hash = util.createHash(hashFunction);

    if (hashSalt) {
      hash.update(hashSalt);
    }

    hash.update(input);

    const digest = hash.digest(hashDigest);

    if (this.options.cache) {
      const defaultCacheKeys = {
        esbuild: pkg.version,
        'esbuild-minimizer-webpack-plugin': require('../package.json').version,
        'esbuild-minimizer-webpack-plugin-options': this.options,
        nodeVersion: process.version,
        filename: file,
        contentHash: digest.substr(0, hashDigestLength),
      };

      task.cacheKeys = defaultCacheKeys;
    }

    yield task;
  }

  async runTasks(assetNames: string[]) {
    const availableNumberOfCores = getAvailableNumberOfCores(this.options.parallel);

    let concurrency = Infinity;
    let worker;

    if (availableNumberOfCores > 0) {
      // Do not create unnecessary workers when the number of files is less than the available cores, it saves memory
      const numWorkers = Math.min(assetNames.length, availableNumberOfCores);

      concurrency = numWorkers;

      worker = new Worker(require.resolve('./minify'), { numWorkers });

      // https://github.com/facebook/jest/issues/8872#issuecomment-524822081
      const workerStdout = worker.getStdout();

      if (workerStdout) {
        workerStdout.on('data', (chunk) => {
          return process.stdout.write(chunk);
        });
      }

      const workerStderr = worker.getStderr();

      if (workerStderr) {
        workerStderr.on('data', (chunk) => {
          return process.stderr.write(chunk);
        });
      }
    }

    const limit = pLimit(concurrency);
    const scheduledTasks: any[] = [];

    for (const assetName of assetNames) {
      const enqueue = async (task) => {
        let taskResult;

        try {
          if (worker) {
            taskResult = await worker.transform(serialize(task));
          } else {
            taskResult = await minifyFn(task);
          }
        } catch (error) {
          taskResult = { error };
        }

        if (this.cache.isEnabled() && !taskResult.error) {
          taskResult = await this.cache.store(task, taskResult).then(
            () => taskResult,
            () => taskResult
          );
        }

        task.callback(taskResult);

        return taskResult;
      };

      scheduledTasks.push(
        limit(() => {
          const task = this.getTaskForAsset(assetName).next().value;

          if (!task) {
            // Something went wrong, for example the `cacheKeys` option throw an error
            return Promise.resolve();
          }

          if (this.cache.isEnabled()) {
            return this.cache.get(task).then(
              (taskResult) => task.callback(taskResult),
              () => enqueue(task)
            );
          }

          return enqueue(task);
        })
      );
    }

    return Promise.all(scheduledTasks).then(() => {
      if (worker) {
        return worker.end();
      }

      return Promise.resolve();
    });
  }

  apply(compiler: Compiler) {
    const plugin = 'ESBuild Plugin';
    compiler.hooks.compilation.tap(
      plugin,
      compilation => {
        compilation.hooks.optimizeChunkAssets.tapPromise(
          plugin,
          this.optimizeFn.bind(this, compiler, compilation)
        )
      }
    );

    compiler.hooks.afterEmit.tapPromise(plugin, async () => {
      const service = await ensureService();
      if (service) {
        service.stop();
      }
    });
  }
}
