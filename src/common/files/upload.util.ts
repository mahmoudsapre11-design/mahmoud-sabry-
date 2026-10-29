import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { diskStorage } from 'multer';
import { extname, join, resolve } from 'path';

interface UploadConfig {
  dir: string;
  maxSize: number;
  mimeRegex: RegExp;
  extensions: string[];
  errorMessage: string;
}

function createUploadOptions(cfg: UploadConfig): MulterOptions {
  return {
    storage: diskStorage({
      destination: `./uploads/${cfg.dir}`,
      // Random name: never trust originalname (collisions / path traversal)
      filename: (_req, file, cb) => cb(null, randomUUID() + extname(file.originalname).toLowerCase()),
    }),
    limits: { fileSize: cfg.maxSize },
    fileFilter: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      if (!cfg.mimeRegex.test(file.mimetype) || !cfg.extensions.includes(ext)) {
        return cb(new BadRequestException(cfg.errorMessage), false);
      }
      cb(null, true);
    },
  };
}

// Program cover image: ./uploads/programs, max 2MB, jpeg|png|webp
export const programImageUpload = createUploadOptions({
  dir: 'programs',
  maxSize: 2 * 1024 * 1024,
  mimeRegex: /^image\/(jpeg|png|webp)$/,
  extensions: ['.jpg', '.jpeg', '.png', '.webp'],
  errorMessage: 'Only jpg, png, webp images are allowed',
});

// Youth CV: ./uploads/cvs, PDF only, max 5MB
export const cvUpload = createUploadOptions({
  dir: 'cvs',
  maxSize: 5 * 1024 * 1024,
  mimeRegex: /^application\/pdf$/,
  extensions: ['.pdf'],
  errorMessage: 'Only PDF files are allowed',
});

// Program materials: ./uploads/materials, PDF only, max 5MB
export const materialUpload = createUploadOptions({
  dir: 'materials',
  maxSize: 5 * 1024 * 1024,
  mimeRegex: /^application\/pdf$/,
  extensions: ['.pdf'],
  errorMessage: 'Only PDF files are allowed',
});

/** Converts a stored URL path (/uploads/x/y.pdf) to an absolute disk path, safely. */
export function toDiskPath(urlPath: string): string | null {
  const root = resolve(process.cwd(), 'uploads');
  const full = resolve(join(process.cwd(), urlPath.replace(/^[/\\]+/, '')));
  return full.startsWith(root) ? full : null;
}

/** Deletes a stored file; silently ignores missing files. */
export async function deleteStoredFile(urlPath?: string | null): Promise<void> {
  if (!urlPath) return;
  const full = toDiskPath(urlPath);
  if (!full) return;
  try {
    await fs.unlink(full);
  } catch {
    /* file already gone */
  }
}
