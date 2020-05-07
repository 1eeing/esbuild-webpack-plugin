export interface Options {
  cache: boolean
  parallel: number | boolean
}

export interface Task {
  file: string
  input: string
  inputSourceMap: any
  commentsFilename: any
  callback: any
  cacheKeys?: any
}
