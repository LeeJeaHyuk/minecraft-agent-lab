export function worldSeed(value = process.env.WORLD_SEED ?? '20261003') {
  if(!/^-?\d+$/.test(value))throw new Error('world_seed_must_be_a_signed_64_bit_integer');
  const seed=BigInt(value);if(seed<-(2n**63n) || seed>2n**63n-1n)throw new Error('world_seed_out_of_range');
  return seed.toString();
}
export function propertiesForSeed(properties, seed, worldExists) {
  const current=properties.match(/^level-seed=(.*)$/m)?.[1]?.trim();
  if(worldExists && current!==seed)throw new Error('world_seed_changed_reset_world_first');
  return /^level-seed=.*$/m.test(properties)?properties.replace(/^level-seed=.*$/m,`level-seed=${seed}`):properties+`\nlevel-seed=${seed}\n`;
}
