/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// ── mocks ──────────────────────────────────────────────────────────────────

jest.mock('react-native-webview', () => {
  const React = require('react');
  const {View} = require('react-native');
  const WebView = React.forwardRef(
    (props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        injectJavaScript: jest.fn(),
      }));
      return <View testID="webview" {...props} />;
    },
  );
  WebView.displayName = 'WebView';
  return {__esModule: true, default: WebView};
});

jest.mock('react-native-bluetooth-classic', () => ({
  __esModule: true,
  default: {
    isBluetoothEnabled: jest.fn().mockResolvedValue(true),
    requestBluetoothEnabled: jest.fn().mockResolvedValue(true),
    getBondedDevices: jest.fn().mockResolvedValue([]),
    connectToDevice: jest.fn().mockResolvedValue({
      name: 'ELM327',
      address: '00:11:22:33:44:55',
      write: jest.fn().mockResolvedValue(true),
      read: jest.fn().mockResolvedValue(''),
      disconnect: jest.fn().mockResolvedValue(true),
    }),
  },
}));

// ── tests ──────────────────────────────────────────────────────────────────

describe('App', () => {
  it('renders without crashing', async () => {
    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(<App />);
    });
  });

  it('renders a WebView', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
    });
    const webview = renderer!.root.findByProps({testID: 'webview'});
    expect(webview).toBeTruthy();
  });

  it('passes HTML source to WebView', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
    });
    const webview = renderer!.root.findByProps({testID: 'webview'});
    expect(webview.props.source).toHaveProperty('html');
    expect(typeof webview.props.source.html).toBe('string');
    expect(webview.props.source.html.length).toBeGreaterThan(0);
  });
});
