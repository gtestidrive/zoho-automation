import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const pages = join(__dirname, '..', 'pages');

function sources(directory: string): Array<{ name: string; tree: ts.SourceFile }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts')
      ? [{ name: relative(pages, path), tree: ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true) }]
      : [];
  });
}

function calls(tree: ts.SourceFile): string[] {
  const names: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) names.push(node.expression.name.text);
      else if (ts.isIdentifier(node.expression)) names.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return names;
}

test('assertion modules verify supplied data without browser actions, polling or source retrieval', () => {
  const forbidden = new Set([
    'click', 'fill', 'check', 'selectOption', 'goto', 'reload', 'evaluate', 'evaluateAll', 'saveAs',
    'fetch', 'readFile', 'readFileSync', 'createReadStream', 'unzipSync', 'poll',
    'readOriginal', 'listCalendars', 'listCalendarInventory', 'getEventDetails', 'getOriginalMessage',
  ]);
  for (const { name, tree } of sources(pages).filter(({ name }) => name.endsWith('.assertions.ts'))) {
    expect(calls(tree).filter((call) => forbidden.has(call)), name).toEqual([]);
    for (const statement of tree.statements.filter(ts.isImportDeclaration)) {
      if (ts.isStringLiteral(statement.moduleSpecifier)) {
        const module = statement.moduleSpecifier.text;
        expect(/^(?:node:fs|node:http|fflate)/.test(module), `${name}: ${module}`).toBe(false);
      }
    }
  }
});

test('locator modules only construct selectors, without reading data or performing actions', () => {
  const forbidden = new Set([
    'click', 'fill', 'check', 'selectOption', 'goto', 'reload', 'evaluate', 'evaluateAll',
    'innerText', 'allInnerTexts', 'textContent', 'count', 'isVisible', 'isEnabled', 'isDisabled',
    'fetch', 'readFile', 'saveAs',
  ]);
  for (const { name, tree } of sources(pages).filter(({ name }) => name.endsWith('.locators.ts'))) {
    expect(calls(tree).filter((call) => forbidden.has(call)), name).toEqual([]);
  }
});

test('page modules use locator modules instead of embedding selector definitions', () => {
  for (const { name, tree } of sources(pages).filter(({ name }) => name.endsWith('.page.ts'))) {
    expect(calls(tree).filter((call) => /^getBy[A-Z]|^locator$/.test(call)), name).toEqual([]);
    for (const owner of tree.statements.filter(ts.isClassDeclaration)) {
      expect(owner.members.filter((member) => ts.isMethodDeclaration(member)
        && /^expect[A-Z]/.test(member.name.getText(tree))).map((member) => member.name?.getText(tree)), name).toEqual([]);
    }
  }
});

test('API modules do not depend on Playwright browser pages or contain test assertions', () => {
  for (const { name, tree } of sources(pages).filter(({ name }) => name.endsWith('.api.ts'))) {
    for (const statement of tree.statements.filter(ts.isImportDeclaration)) {
      if (ts.isStringLiteral(statement.moduleSpecifier)) {
        expect(statement.moduleSpecifier.text, name).not.toContain('playwright');
      }
    }
    expect(calls(tree).filter((call) => ['expect', 'goto', 'getByRole', 'getByText'].includes(call)), name).toEqual([]);
  }
});
