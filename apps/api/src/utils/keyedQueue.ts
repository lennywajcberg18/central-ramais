// Fila serial por chave.
//
// Por quê: o Twilio entrega em paralelo. Duas mensagens do mesmo contato
// processadas ao mesmo tempo fazem "procura conversa ativa" e "cria conversa"
// se cruzarem — as duas não acham nada e as duas criam. Serializando por
// contato, a segunda só começa depois que a primeira já gravou.
//
// Chaves diferentes seguem em paralelo: um hospital movimentado não fica preso
// atrás do contato mais lento.

// Cauda de cada chave: a promise da última tarefa enfileirada.
const tails = new Map<string, Promise<void>>();

export function runSerialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();

  const result = previous.then(task);

  // A cauda ignora resultado e erro: tarefa que falha libera a fila para as
  // seguintes em vez de travá-la (e não vira unhandled rejection aqui — quem
  // chamou recebe o erro pelo `result`).
  const tail = result.then(
    () => undefined,
    () => undefined
  );

  tails.set(key, tail);

  // Sem isto o Map cresce para sempre — um contato atendido uma vez deixaria
  // a chave viva pelo resto do processo. Só remove se ninguém entrou na fila
  // depois de nós; se entrou, a chave pertence à tarefa mais nova.
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });

  return result;
}

// Exposto para teste/diagnóstico: quantas chaves têm fila viva agora.
export function pendingKeyCount(): number {
  return tails.size;
}
