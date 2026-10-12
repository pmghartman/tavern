import { randomInt } from 'node:crypto';

export const cryptoRng = {
  int: (min, max) => randomInt(min, max + 1),
  float: () => randomInt(0, 2 ** 32) / 2 ** 32,
};
