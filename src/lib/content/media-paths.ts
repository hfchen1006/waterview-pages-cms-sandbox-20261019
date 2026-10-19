import { uploadPath } from './schemas.ts';

export function mediaPaths(src: string) {
  const name = uploadPath.parse(src).split('/').at(-1)!;
  return {
    original: `/_media/${name}`,
    transformed: `/_media/${name.replace(/\.png$/, '.webp')}`,
  };
}
