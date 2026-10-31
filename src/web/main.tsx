import '@fontsource-variable/plus-jakarta-sans';
import { render } from 'preact';
import { App } from './App.js';
import { connect } from './store.js';
import './styles.css';

connect();
render(<App />, document.getElementById('app')!);
