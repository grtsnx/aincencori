import { Injectable } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';

// Argon2id with OWASP's recommended minimum cost (19 MiB, 2 passes, 1 lane).
const options = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

// Every one-way hash in the app goes through here (Better Auth passwords too).
@Injectable()
export class HashService {
  hash(value: string): Promise<string> {
    return hash(value, options);
  }

  // False for a wrong value or a malformed hash; never throws for those.
  async verify(hashed: string, value: string): Promise<boolean> {
    try {
      return await verify(hashed, value);
    } catch {
      return false;
    }
  }
}
