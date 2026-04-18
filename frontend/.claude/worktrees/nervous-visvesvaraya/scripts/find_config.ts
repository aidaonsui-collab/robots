import { JsonRpcProvider } from '@mysten/sui';

const provider = new JsonRpcProvider('https://sui-mainnet-rpc.allthatnode.com');

async function main() {
  const newPkg = '0x7d06213cb4fe0b96c889c09e469a44d1614563efbb23bd4b43e0985d87a210f3';
  const deployer = '0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409';
  
  console.log('Querying owned objects...');
  
  try {
    const r1 = await (provider as any).getOwnedObjects({
      owner: deployer,
      filter: { StructType: `${newPkg}::moonbags::Configuration` }
    });
    console.log('Moonbags Config:', JSON.stringify(r1.data));
  } catch(e: any) {
    console.log('Error:', e.message);
  }
  
  try {
    const r2 = await (provider as any).getOwnedObjects({
      owner: deployer,
      filter: { StructType: `${newPkg}::moonbags_stake::Configuration` }
    });
    console.log('Stake Config:', JSON.stringify(r2.data));
  } catch(e: any) {
    console.log('Error:', e.message);
  }
  
  try {
    const r3 = await (provider as any).getOwnedObjects({
      owner: deployer,
      filter: { StructType: `${newPkg}::moonbags_token_lock::Configuration` }
    });
    console.log('Lock Config:', JSON.stringify(r3.data));
  } catch(e: any) {
    console.log('Error:', e.message);
  }
}

main().catch(console.error);
