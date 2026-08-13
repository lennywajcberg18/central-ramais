// Teste manual da T1.1: npx tsx scripts/test-provider.ts
import { getProviderFor } from '../src/providers';

async function main() {
  const provider = getProviderFor('+14155238886');
  const result = await provider.sendText('+5521999999999', 'Teste do provider mock.');
  console.log('providerMessageId:', result.providerMessageId);
}

main();
