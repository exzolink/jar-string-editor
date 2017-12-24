/*
 *  Copyright (C) 2017 leonardosnt (leonrdsnt@gmail)
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License along
 *  with this program; if not, write to the Free Software Foundation, Inc.,
 *  51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
*/

import { utf8ByteArrayToString } from 'utf8-string-bytes';
import React, { Component } from 'react';
import update from 'react-addons-update';
import debounce from 'lodash.debounce';
import JSZip from 'jszip';
import SVGInline from 'react-svg-inline';

import { readFileAsArrayBuffer } from './util/file-reader';
import { Button, SettingsPanel, FileSelector, StringList } from './components';
import { getInstructionContext } from './util/jct-util';
import { stringContains } from './util/string-util';
import { saveAs } from 'file-saver';

import StringReader from './StringReader';
import StringWriter from './StringWriter';
import settings from './settings';

import gearIcon from './icons/gear.svg';
import coffeeIcon from './icons/coffee.svg';

import './App.css';

class App extends Component {
  static INITIAL_CONTEXT = Object.freeze({
    loadedJar: undefined,
    selectedFileName: undefined,
    strings: [],
    filter: undefined,
  });

  state = {
    context: { ...App.INITIAL_CONTEXT },
  };

  constructor(props) {
    super(props);

    const debounced = debounce(this.onSearchChange.bind(this), 200);
    this.onSearchChange = e => {
      e.persist();
      return debounced(e);
    };

    // Update when settings change
    settings.observe(() => this.forceUpdate());
  }

  clearContext = () => {
    if (this.stringReader) {
      this.stringReader.stop();
    }

    this.setState({ context: { ...App.INITIAL_CONTEXT } });
  };

  onSaveFile = ({ target }) => {
    const { context } = this.state;

    // Disable button while saving
    target.disabled = true;

    StringWriter.write(context.loadedJar, context.strings)
      .then(blob => {
        saveAs(blob, context.selectedFileName || 'Translated.jar');
      })
      .then(() => (target.disabled = false));

    if (window.ga) {
      window.ga('send', 'event', 'file', 'save');
    }
  };

  onJarLoaded = (jar, selectedFileName) => {
    let stringReader = (this.stringReader = new StringReader());
    let foundStrings = [];
    let stringId = 0;

    this.setState(state =>
      update(state, {
        loadInfo: { $set: `Descompactando ${numClasses} classes` },
        context: {
          loadedJar: { $set: jar },
          selectedFileName: { $set: selectedFileName },
        },
      })
    );

    stringReader.on(
      'found',
      ({
        fileName,
        classFile,
        constantIndex,
        instructionIndex,
        instructions,
        method,
      }) => {
        const constantEntry = classFile.constant_pool[constantIndex];
        const utf8Constant =
          classFile.constant_pool[constantEntry.string_index];
        const value = utf8ByteArrayToString(utf8Constant.bytes);
        const context = getInstructionContext(
          classFile,
          method,
          instructions[instructionIndex]
        );

        foundStrings.push({
          constantIndex,
          context,
          fileName,
          value,
          id: stringId++,
        });
      }
    );

    const numClasses = jar.filter(path => path.endsWith('.class')).length;

    stringReader.on('read_count', num => {
      this.setState({ loadInfo: `Procurando ${num}/${numClasses} classes` });
    });

    stringReader.on('finish', () => {
      // We don't need this anymore
      delete this.stringReader;

      console.timeEnd('load');
      this.setState(state =>
        update(state, {
          loadInfo: { $set: undefined },
          context: {
            strings: { $set: foundStrings },
          },
        })
      );
    });

    console.time('load');
    stringReader.searchInJar(jar);
  };

  onFileSelected = file => {
    if (window.ga) {
      window.ga('send', 'event', 'file', 'select', file.size);
    }

    return readFileAsArrayBuffer(file)
      .then(JSZip.loadAsync)
      .then(jar => this.onJarLoaded(jar, file.name));
  };

  onSearchChange = ({ target }) => {
    this.setState(state =>
      update(state, { context: { filter: { $set: target.value } } })
    );
  };

  onStringChanged = (newValue, stringId) => {
    const { context } = this.state;
    const string = context.strings[stringId];

    if (newValue !== string.value) {
      string.value = newValue;
      string.changed = true;
    }
  };

  filterStrings = () => {
    const { context } = this.state;
    const filtered = [];

    const filterStart = performance.now();

    for (const string of context.strings) {
      const { value } = string;

      if (settings.hideEmptyStrings && !value.trim().length) continue;

      // No filter is applied
      if (!context.filter) {
        filtered.push(string);
        continue;
      }

      const words = context.filter.split(' ');
      const foundAllWords = !words.find(w => !stringContains(value, w));

      if (foundAllWords) {
        filtered.push({ ...string, highlightWords: words });
      }
    }

    const filterEnd = performance.now();

    console.timeEnd('search');
    return { filtered, took: filterEnd - filterStart };
  };

  appContainer = children => (
    <div className="app-container">
      <SettingsPanel />

      <h2 className="brand" onClick={this.clearContext}>
        Jar String Editor
      </h2>

      {children}
    </div>
  );

  render() {
    const { loadInfo, context } = this.state;

    if (context.loadedJar === undefined) {
      return this.appContainer(
        <div>
          <FileSelector onSelected={this.onFileSelected} />
          <Footer />
        </div>
      );
    }

    if (loadInfo) {
      return this.appContainer(
        <div className="load-info-box">
          <SVGInline width={'100px'} svg={gearIcon} />
          <p>{loadInfo}</p>
        </div>
      );
    }

    const { filtered, took } = this.filterStrings();

    return this.appContainer(
      <div>
        <div className="header">
          <div className="search">
            <div>Pesquisar</div>
            <input onChange={this.onSearchChange} />
          </div>
          <div className="info">
            <span>
              {context.strings.length} strings encontradas | {filtered.length}{' '}
              após filtro (Levou {took.toFixed(2)} ms)
            </span>
            <Button onClick={this.onSaveFile} className="save-btn">
              Salvar
            </Button>
          </div>
        </div>

        <StringList onStringChanged={this.onStringChanged} strings={filtered} />
      </div>
    );
  }
}

const Footer = () => (
  <div
    style={{
      textAlign: 'center',
      padding: '1em',
      paddingTop: '1.5em',
      color: 'rgba(0,0,0,.8)',
    }}
  >
    {'Feito com muito '}
    <SVGInline title="café" width={'15px'} svg={coffeeIcon} />
    {' por '}
    <a
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: 'rgba(0,0,0,.9)',
        textDecoration: 'none',
      }}
      href="https://github.com/leonardosnt"
    >
      leonardosnt
    </a>
    {'.'}
    {'   '}
    <div style={{ paddingTop: '.6em' }}>
      <b>
        <a
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'rgba(0,0,0,.9)',
            textDecoration: 'none',
            fontSize: '.75em',
          }}
          href="https://jar-string-editor-v1.now.sh/"
        >
          Não gostou a nova versão? Clique aqui para usar a antiga.
        </a>
      </b>
    </div>
  </div>
);

window.__BUILD_INFO__ = process.env.__BUILD_INFO__;

export default App;
