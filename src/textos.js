// Todas as mensagens que o bot pode enviar ficam neste arquivo.
// E aqui que o Anderson e a Eliana revisam. Nenhum texto fica solto no codigo.
//
// Marcadores disponiveis: {{minimo}}, {{link11}}, {{link74}}

export const textos = {
  saudacao:
    'Olá! Aqui é a Costa & Montenegro. 👋\n\n' +
    'Para agilizar o seu atendimento, me diga o que você procura:\n\n' +
    '*1* - Cola hot melt granulada\n' +
    '*2* - Bastão de cola quente\n' +
    '*3* - Outro assunto\n\n' +
    'É só responder com o número.',

  perguntaQuantidade:
    'Perfeito! Qual a quantidade aproximada que você precisa, em *kg*?\n\n' +
    'Pode responder só com o número. Ex.: 50',

  naoEntendiQuantidade:
    'Desculpe, não consegui entender a quantidade. 🙈\n\n' +
    'Pode me informar só o número em kg? Ex.: 50',

  leadQualificado:
    'Obrigado! Já anotei o seu pedido. ✅\n\n' +
    'Um de nossos atendentes vai falar com você aqui mesmo, em instantes.',

  // Bastao abaixo do minimo: existe anuncio pronto no Mercado Livre.
  bastaoAbaixoDoMinimo:
    'Obrigado pelo contato! Para essa quantidade, o caminho mais rápido é pela nossa loja, ' +
    'com compra imediata e envio para todo o Brasil:\n\n' +
    '🔸 Bastão 11mm (mais comum, pistolas industriais):\n{{link11}}\n\n' +
    '🔸 Bastão 7,4mm (pistolas menores):\n{{link74}}\n\n' +
    'A medida certa é a que encaixa na sua pistola. Se precisar de um volume maior, ' +
    'é só chamar por aqui. 😉',

  // Granulado abaixo do minimo: nao temos anuncio, entao vai para atendimento.
  granuladoAbaixoDoMinimo:
    'Obrigado pelo contato! O granulado nós fornecemos a partir de {{minimo}} kg. 🙂\n\n' +
    'Vou passar você para um de nossos atendentes para ver a melhor opção no seu caso. ' +
    'É só aguardar um instante.',

  outroAssunto:
    'Certo! Aguarde um instante, por favor. ' +
    'Um de nossos atendentes vai te responder aqui mesmo. 🙂',

  naoEntendiMenu:
    'Desculpe, não entendi. 🙈\n\n' +
    'Responda com *1* para cola granulada, *2* para bastão, ou *3* para outro assunto.',

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
