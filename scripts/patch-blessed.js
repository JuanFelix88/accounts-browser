/**
 * Patches blessed internals for Bun bundler compatibility:
 * 1. widget.js — replaces dynamic require('./widgets/' + file) with static ones
 * 2. terminal.js — stubs out term.js/pty.js deps (optional, not used)
 * Run this before `bun build`.
 */

const fs = require("fs");
const path = require("path");

const blessedDir = path.join(__dirname, "..", "node_modules", "blessed", "lib");
const widgetPath = path.join(blessedDir, "widget.js");
const terminalPath = path.join(blessedDir, "widgets", "terminal.js");

const original = fs.readFileSync(widgetPath, "utf-8");

// Skip if already patched
if (original.includes("// PATCHED-STATIC")) {
  console.log("blessed already patched.");
  process.exit(0);
}

// Patch terminal.js — stub out term.js and pty.js
const terminalStub = `/**
 * terminal.js - STUBBED for Bun bundler compatibility
 * Original requires term.js and pty.js which are optional.
 */
// PATCHED-STATIC
module.exports = function() { throw new Error('Terminal widget not available in bundled mode'); };
`;
fs.writeFileSync(terminalPath, terminalStub, "utf-8");
console.log("✅ Patched blessed/lib/widgets/terminal.js — stubbed.");

const patched = `/**
 * widget.js - high-level interface for blessed
 * Copyright (c) 2013-2015, Christopher Jeffrey and contributors (MIT License).
 * https://github.com/chjj/blessed
 */
// PATCHED-STATIC — static requires for Bun bundler compatibility

var widget = exports;

widget.classes = [
  'Node', 'Screen', 'Element', 'Box', 'Text', 'Line',
  'ScrollableBox', 'ScrollableText', 'BigText', 'List',
  'Form', 'Input', 'Textarea', 'Textbox', 'Button',
  'ProgressBar', 'FileManager', 'Checkbox', 'RadioSet',
  'RadioButton', 'Prompt', 'Question', 'Message', 'Loading',
  'Listbar', 'Log', 'Table', 'ListTable', 'Terminal',
  'Image', 'ANSIImage', 'OverlayImage', 'Video', 'Layout'
];

widget.Node = widget.node = require('./widgets/node');
widget.Screen = widget.screen = require('./widgets/screen');
widget.Element = widget.element = require('./widgets/element');
widget.Box = widget.box = require('./widgets/box');
widget.Text = widget.text = require('./widgets/text');
widget.Line = widget.line = require('./widgets/line');
widget.ScrollableBox = widget.scrollablebox = require('./widgets/scrollablebox');
widget.ScrollableText = widget.scrollabletext = require('./widgets/scrollabletext');
widget.BigText = widget.bigtext = require('./widgets/bigtext');
widget.List = widget.list = require('./widgets/list');
widget.Form = widget.form = require('./widgets/form');
widget.Input = widget.input = require('./widgets/input');
widget.Textarea = widget.textarea = require('./widgets/textarea');
widget.Textbox = widget.textbox = require('./widgets/textbox');
widget.Button = widget.button = require('./widgets/button');
widget.ProgressBar = widget.progressbar = require('./widgets/progressbar');
widget.FileManager = widget.filemanager = require('./widgets/filemanager');
widget.Checkbox = widget.checkbox = require('./widgets/checkbox');
widget.RadioSet = widget.radioset = require('./widgets/radioset');
widget.RadioButton = widget.radiobutton = require('./widgets/radiobutton');
widget.Prompt = widget.prompt = require('./widgets/prompt');
widget.Question = widget.question = require('./widgets/question');
widget.Message = widget.message = require('./widgets/message');
widget.Loading = widget.loading = require('./widgets/loading');
widget.Listbar = widget.listbar = require('./widgets/listbar');
widget.Log = widget.log = require('./widgets/log');
widget.Table = widget.table = require('./widgets/table');
widget.ListTable = widget.listtable = require('./widgets/listtable');

// Terminal requires optional deps (term.js, pty.js) — skipped for bundler
widget.Terminal = widget.terminal = function() { throw new Error('Terminal widget not available in bundled mode'); };

widget.Image = widget.image = require('./widgets/image');
widget.ANSIImage = widget.ansiimage = require('./widgets/ansiimage');
widget.OverlayImage = widget.overlayimage = require('./widgets/overlayimage');
widget.Video = widget.video = require('./widgets/video');
widget.Layout = widget.layout = require('./widgets/layout');

widget.aliases = { 'ListBar': 'Listbar', 'PNG': 'ANSIImage' };

Object.keys(widget.aliases).forEach(function(key) {
  var name = widget.aliases[key];
  widget[key] = widget[name];
  widget[key.toLowerCase()] = widget[name];
});
`;

fs.writeFileSync(widgetPath, patched, "utf-8");
console.log("✅ Patched blessed/lib/widget.js — dynamic requires replaced.");
