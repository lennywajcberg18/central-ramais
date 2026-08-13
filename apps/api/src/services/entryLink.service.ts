import * as entryLinks from '../repositories/entryLinks';
import * as whatsappNumbers from '../repositories/whatsappNumbers';

export interface RedirectTarget {
  url: string;
}

// GET /c/:slug — 302 para wa.me, contando o uso. null → 404 (inexistente ou revogado).
export async function resolveRedirect(slug: string): Promise<RedirectTarget | null> {
  const link = await entryLinks.findBySlug(slug);
  if (!link || !link.active) return null;

  const number = await whatsappNumbers.findActiveForTenant(link.tenantId);
  if (!number) return null;

  await entryLinks.incrementUseCount(link.tenantId, link.id);

  // wa.me usa o número sem o "+"
  const waNumber = number.phoneNumber.replace(/^\+/, '');
  const text = encodeURIComponent(link.prefillText);
  return { url: `https://wa.me/${waNumber}?text=${text}` };
}
