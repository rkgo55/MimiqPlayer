declare module 'music-metadata' {
  export interface IPicture {
    format: string;
    data: Uint8Array<ArrayBuffer>;
    description?: string;
    type?: string;
  }

  export interface ICommonTagsResult {
    title?: string;
    artist?: string;
    album?: string;
    picture?: IPicture[];
    [key: string]: unknown;
  }

  export interface IFormat {
    duration?: number;
    bitrate?: number;
    sampleRate?: number;
    numberOfChannels?: number;
    [key: string]: unknown;
  }

  export interface IAudioMetadata {
    common: ICommonTagsResult;
    format: IFormat;
    native: Record<string, unknown[]>;
    quality: {
      warnings: Array<{ message: string }>;
    };
  }

  export interface IOptions {
    mimeType?: string;
    size?: number;
    duration?: boolean;
    skipCovers?: boolean;
    [key: string]: unknown;
  }

  export function parseBuffer(
    buf: Uint8Array | Buffer,
    options?: IOptions,
  ): Promise<IAudioMetadata>;

  export function parseBlob(
    blob: Blob,
    options?: IOptions,
  ): Promise<IAudioMetadata>;
}

