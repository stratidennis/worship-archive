import { describe, expect, it } from 'vitest';
import { isLoopbackAddress } from '../src/network.js';

describe('the local Leader boundary', () => {
  it.each(['127.0.0.1', '127.42.0.8', '::1', '::ffff:127.0.0.1', 'localhost'])(
    'accepts loopback address %s',
    (address) => expect(isLoopbackAddress(address)).toBe(true),
  );

  it.each(['192.168.1.8', '10.0.0.12', '172.16.0.4', 'fe80::1', undefined])(
    'rejects remote address %s',
    (address) => expect(isLoopbackAddress(address)).toBe(false),
  );
});
