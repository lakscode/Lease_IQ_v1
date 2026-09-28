// Shrinks page text before it goes into a Claude prompt, without changing its
// wording: extracted and OCR text carries runs of spaces, blank lines and
// dot/underscore leaders ("Rent ........ $4,500", signature lines) that all
// count as input tokens.

export function compactText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v ]+/g, ' ') // runs of spaces and tabs -> one space
    .replace(/([._\-=*~·•])\1{3,}/g, '$1$1$1') // leaders and rules -> three characters
    .replace(/ *\n */g, '\n') // spaces around line breaks
    .replace(/\n{3,}/g, '\n\n') // at most one blank line
    .trim()
}
