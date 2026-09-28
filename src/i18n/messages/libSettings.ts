import { defineMessages } from '..'

// Notes for the Claude model options on the super-admin Settings page (src/lib/settings.ts).
export const libSettings = defineMessages({
  en: {
    note_opus5: 'Default. Strong accuracy for lease analysis. $5 / $25 per million tokens (input / output).',
    note_opus55: 'Newest Opus, lower price. $4 / $20 per million tokens.',
    note_fable51: 'Most capable and slowest. Requires 30-day data retention on your Anthropic account. $10 / $50 per million tokens.',
    note_sonnet5: 'Faster and cheaper, a little less thorough. $2 / $10 per million tokens.',
    note_opus48: 'Previous-generation Opus. $5 / $25 per million tokens.',
  },
  de: {
    note_opus5: 'Standard. Hohe Genauigkeit bei der Mietvertragsanalyse. 5 $ / 25 $ pro Million Tokens (Eingabe / Ausgabe).',
    note_opus55: 'Neuestes Opus, günstiger. 4 $ / 20 $ pro Million Tokens.',
    note_fable51:
      'Am leistungsfähigsten und am langsamsten. Erfordert eine 30-tägige Datenaufbewahrung in Ihrem Anthropic-Konto. 10 $ / 50 $ pro Million Tokens.',
    note_sonnet5: 'Schneller und günstiger, etwas weniger gründlich. 2 $ / 10 $ pro Million Tokens.',
    note_opus48: 'Opus der vorherigen Generation. 5 $ / 25 $ pro Million Tokens.',
  },
  es: {
    note_opus5: 'Predeterminado. Gran precisión en el análisis de contratos. 5 US$ / 25 US$ por millón de tokens (entrada / salida).',
    note_opus55: 'El Opus más reciente, a menor precio. 4 US$ / 20 US$ por millón de tokens.',
    note_fable51:
      'El más capaz y el más lento. Requiere retención de datos de 30 días en su cuenta de Anthropic. 10 US$ / 50 US$ por millón de tokens.',
    note_sonnet5: 'Más rápido y económico, algo menos exhaustivo. 2 US$ / 10 US$ por millón de tokens.',
    note_opus48: 'Opus de la generación anterior. 5 US$ / 25 US$ por millón de tokens.',
  },
  pt: {
    note_opus5: 'Padrão. Alta precisão na análise de contratos. US$ 5 / US$ 25 por milhão de tokens (entrada / saída).',
    note_opus55: 'Opus mais recente, com preço menor. US$ 4 / US$ 20 por milhão de tokens.',
    note_fable51:
      'O mais capaz e o mais lento. Exige retenção de dados de 30 dias na sua conta Anthropic. US$ 10 / US$ 50 por milhão de tokens.',
    note_sonnet5: 'Mais rápido e mais barato, um pouco menos minucioso. US$ 2 / US$ 10 por milhão de tokens.',
    note_opus48: 'Opus da geração anterior. US$ 5 / US$ 25 por milhão de tokens.',
  },
  it: {
    note_opus5: 'Predefinito. Elevata precisione nell’analisi dei contratti. 5 $ / 25 $ per milione di token (input / output).',
    note_opus55: 'Opus più recente, prezzo inferiore. 4 $ / 20 $ per milione di token.',
    note_fable51:
      'Il più capace e il più lento. Richiede la conservazione dei dati per 30 giorni sul tuo account Anthropic. 10 $ / 50 $ per milione di token.',
    note_sonnet5: 'Più veloce ed economico, un po’ meno accurato. 2 $ / 10 $ per milione di token.',
    note_opus48: 'Opus della generazione precedente. 5 $ / 25 $ per milione di token.',
  },
})
