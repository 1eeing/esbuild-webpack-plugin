import { startService, Service } from 'esbuild';
import { Task } from './types';

let _service: Service;
export const ensureService = async () => {
  if (!_service) {
    _service = await startService();
  }
  return _service;
};

export const minify = async ({
  input,
}: Task) => {
  const service = await ensureService();
  let error;
  let code;

  try {
    code = await service.transform(input, {
      minify: true,
    })
  } catch (e) {
    error = e;
  }

  return { code: code.js || code.css || '', error };
}

export const transfrom = async (task: Task) => {
  task = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    `'use strict'\nreturn ${task}`
  )(exports, require, module, __filename, __dirname);

  const result = await minify(task);

  if (result.error) {
    throw result.error;
  } else {
    return result;
  }
}
