const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { parseTable, isSwapped } = require('../content.js');

function readFixture() {
  return fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');
}

function parse(html) {
  const dom = new JSDOM(html);
  const table = dom.window.document.querySelector('#nittei');
  return { dom, table, model: parseTable(table) };
}

test('参加者・日程・○△×を読み取る', () => {
  const { table, model } = parse(readFixture());

  assert.ok(model);
  assert.deepEqual(
    model.members.map((member) => member.name),
    ['山田', '佐藤', '鈴木']
  );
  assert.deepEqual(
    model.members.map((member) => member.cellIndex),
    [4, 5, 6]
  );
  assert.equal(model.dates.length, 2);
  assert.equal(model.dates[0].label, '1/8(日) 一日中OK');
  assert.deepEqual(model.dates[0].marks, ['○', '△', '×']);
  assert.deepEqual(model.dates[1].marks, ['○', '-', '×']);
  assert.equal(isSwapped(table), false);
});

test('コメント行は日程として扱わない', () => {
  const { model } = parse(readFixture());
  assert.equal(model.dates.some((date) => date.label === 'コメント'), false);
});

test('同名の参加者を区別する', () => {
  const html = `
    <table id="nittei">
      <tr>
        <td>日程</td><td>◯</td><td>△</td><td>×</td>
        <td id="member_0"><a>山田</a></td>
        <td id="member_1"><a>山田</a></td>
      </tr>
      <tr>
        <td>1/1</td><td>1</td><td>0</td><td>0</td>
        <td><img src="mark-ok.svg"></td>
        <td><img src="mark-x.svg"></td>
      </tr>
    </table>
  `;
  const { model } = parse(html);
  assert.deepEqual(
    model.members.map((member) => member.label),
    ['山田 (1)', '山田 (2)']
  );
});

test('行と列の入れ替えを検出する', () => {
  const html = `
    <table id="nittei">
      <tr><td>名前</td><td>1/1</td><td>1/2</td></tr>
      <tr>
        <td id="member_0"><a>山田</a></td>
        <td><img src="mark-ok.svg"></td>
        <td><img src="mark-x.svg"></td>
      </tr>
      <tr>
        <td id="member_1"><a>佐藤</a></td>
        <td><img src="mark-tri.svg"></td>
        <td><img src="mark-ok.svg"></td>
      </tr>
    </table>
  `;
  const { table, model } = parse(html);
  assert.equal(isSwapped(table), true);
  assert.equal(model, null);
});

test('参加者の見出しがない表は読み取らない', () => {
  const html = `
    <table id="nittei">
      <tr><td>日程</td><td>◯</td><td>△</td><td>×</td></tr>
      <tr><td>1/1</td><td>0</td><td>0</td><td>0</td></tr>
    </table>
  `;
  const { model } = parse(html);
  assert.equal(model, null);
});
