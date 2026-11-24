// Todas as mensagens que o bot pode enviar ficam neste arquivo.
// E aqui que o Anderson e a Eliana revisam. Nenhum texto fica solto no codigo.

export const textos = {
  saudacao:
    'Olá! Aqui é a Costa & Montenegro. 👋\n\n' +
    'Para agilizar o seu atendimento, me diga o que você procura:\n\n' +
    '*1* - Cola hot melt (granulada ou bastão)\n' +
    '*2* - Outro assunto\n\n' +
    'É só responder com o número.',

  perguntaQuantidade:
    'Perfeito! Qual a quantidade aproximada que você precisa, em *kg*?\n\n' +
    'Pode responder só com o número. Ex.: 50',

  // {{minimo}} e substituido pelo MINIMO_KG
  naoEntendiQuantidade:
    'Desculpe, não consegui entender a quantidade. 🙈\n\n' +
    'Pode me informar só o número em kg? Ex.: 50',

  leadQualificado:
    'Obrigado! Já anotei o seu pedido. ✅\n\n' +
    'Um de nossos atendentes vai falar com você aqui mesmo, em instantes.',

  // {{link}} e substituido pelo LINK_MERCADO_LIVRE
  abaixoDoMinimo:
    'Obrigado pelo contato! Para essa quantidade, o caminho mais rápido é pela nossa loja, ' +
    'com compra imediata e envio para todo o Brasil:\n\n' +
    '{{link}}\n\n' +
    'Se mais pra frente você precisar de um volume maior, é só chamar por aqui. 😉',

  outroAssunto:
    'Certo! Aguarde um instante, por favor. ' +
    'Um de nossos atendentes vai te responder aqui mesmo. 🙂',

  naoEntendiMenu:
    'Desculpe, não entendi. 🙈\n\n' +
    'Responda com *1* para cola hot melt, ou *2* para outro assunto.',

  desistoVaiProHumano:
    'Sem problema! Vou passar você para um de nossos atendentes. ' +
    'É só aguardar um instante. 🙂',
};

export function montar(modelo, variaveis = {}) {
  return Object.entries(variaveis).reduce(
    (texto, [chave, valor]) => texto.replaceAll(`{{${chave}}}`, String(valor)),
    modelo,
  );
}
