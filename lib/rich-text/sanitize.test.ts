import { describe, expect, it } from "vitest";
import {
  isRichHtml,
  isRichTextEmpty,
  plainTextToEditorHtml,
  renderRichText,
  richTextToPlain,
  sanitizeRichHtml,
} from "./sanitize";

describe("sanitizeRichHtml", () => {
  it("mantém a formatação permitida", () => {
    const h = "<p><strong>Obra</strong> na <em>piscina</em> e <u>portão</u></p><ul><li>um</li><li>dois</li></ul>";
    expect(sanitizeRichHtml(h)).toBe(h);
  });

  it("remove script com o conteúdo e atributos perigosos", () => {
    expect(sanitizeRichHtml('<p onclick="x()">oi<script>alert(1)</script></p>')).toBe("<p>oi</p>");
    expect(sanitizeRichHtml('<img src=x onerror=alert(1)><p>ok</p>')).toBe("<p>ok</p>");
  });

  it("link só com http/https/mailto/tel, sempre em nova aba", () => {
    expect(sanitizeRichHtml('<a href="https://x.com/a?b=1&amp;c=2">x</a>')).toBe(
      '<a href="https://x.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">x</a>',
    );
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
  });

  it("tag desconhecida some mas o texto fica", () => {
    expect(sanitizeRichHtml("<p><span style='color:red'>vermelho</span></p>")).toBe("<p>vermelho</p>");
  });

  it("fecha tags abertas e ignora fechamento órfão", () => {
    expect(sanitizeRichHtml("<p><strong>sem fechar")).toBe("<p><strong>sem fechar</strong></p>");
    expect(sanitizeRichHtml("texto</strong>")).toBe("texto");
  });
});

describe("renderRichText (compatível com texto antigo)", () => {
  it("texto puro antigo: escapa e quebra linha", () => {
    expect(isRichHtml("linha 1\nlinha <2>")).toBe(false);
    expect(renderRichText("linha 1\nlinha <2>")).toBe("linha 1<br>linha &lt;2&gt;");
  });

  it("texto novo do editor: sanitiza", () => {
    expect(renderRichText("<p>a<script>x</script></p>")).toBe("<p>a</p>");
  });
});

describe("conversões", () => {
  it("texto puro vira parágrafos pro editor", () => {
    expect(plainTextToEditorHtml("a\nb & c")).toBe("<p>a</p><p>b &amp; c</p>");
  });

  it("rich → texto puro (busca/IA)", () => {
    expect(richTextToPlain("<p><strong>Oi</strong> &amp; tchau</p><ul><li>um</li></ul>")).toBe("Oi & tchau\n• um");
  });

  it("editor vazio conta como vazio", () => {
    expect(isRichTextEmpty("<p></p>")).toBe(true);
    expect(isRichTextEmpty("<p> </p>")).toBe(true);
    expect(isRichTextEmpty("<p>x</p>")).toBe(false);
  });
});
