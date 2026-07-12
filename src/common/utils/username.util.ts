import { BadRequestException } from '@nestjs/common';

const USERNAME_PATTERN = /^[a-z0-9._]{3,32}$/;

export function normalizeUsername(input: string): string {
  const username = input.trim().toLowerCase();

  if (!USERNAME_PATTERN.test(username)) {
    throw new BadRequestException(
      'Username harus 3–32 karakter dan hanya huruf kecil, angka, titik, atau underscore',
    );
  }

  return username;
}
