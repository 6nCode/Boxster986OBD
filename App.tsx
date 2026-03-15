/**
 * Boxster 986 OBD — App.tsx v3
 * HTML dans AppHtml.js (fichier separe) pour eviter les problemes
 * de parsing Metro avec les strings de grande taille.
 *
 * PIDs OBD2 polles :
 *   0x0C RPM | 0x0D Vitesse | 0x05 Temp eau | 0x04 Charge
 *   0x11 Papillon | 0x0B MAP | 0x0F Temp admission
 *   0x14 O2 B1S1 | 0x42 Tension batterie | 0x5C Temp huile
 */

import React, {useEffect, useRef, useCallback} from 'react';
import {StyleSheet, View, PermissionsAndroid, Platform, StatusBar} from 'react-native';
import WebView from 'react-native-webview';
import RNBluetoothClassic, {BluetoothDevice} from 'react-native-bluetooth-classic';
import {
  parseRpm, parseSpeed, parseCoolant, parseLoad, parseThrottle,
  parseMap, parseIntake, parseO2, parseBattVolt, parseOil,
} from './obd';

// HTML dans un fichier .js separe — Metro compile chaque fichier independamment
// Evite les problemes de template literals imbriques et d'encodage
const APP_HTML: string = require('./AppHtml.js');


type WVMsg =
  | {type: 'SCAN'}
  | {type: 'CONNECT'; address: string}
  | {type: 'DISCONNECT'}
  | {type: 'SEND_CMD'; cmd: string; tag: string};

// Allowed OBD-II service 01 PIDs and ELM327 AT commands
const ALLOWED_PIDS = new Set([
  '0C','0D','05','04','11','0B','0F','14','42','5C',
  '03','07','01','09','0A',
]);
const AT_CMD_RE = /^AT[A-Z0-9 ]{1,20}$/i;

function isValidObdCmd(cmd: string): boolean {
  const upper = cmd.trim().toUpperCase();
  return ALLOWED_PIDS.has(upper) || AT_CMD_RE.test(upper);
}

function isValidWVMsg(m: unknown): m is WVMsg {
  if (!m || typeof m !== 'object') return false;
  const obj = m as Record<string, unknown>;
  switch (obj.type) {
    case 'SCAN':
    case 'DISCONNECT':
      return true;
    case 'CONNECT':
      return typeof obj.address === 'string' && obj.address.length > 0;
    case 'SEND_CMD':
      return typeof obj.cmd === 'string' &&
             typeof obj.tag === 'string' &&
             isValidObdCmd(obj.cmd);
    default:
      return false;
  }
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function App() {
  const wv       = useRef<WebView>(null);
  const devRef   = useRef<BluetoothDevice | null>(null);
  const loopRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const errCount = useRef(0);

  useEffect(() => {
    (async () => {
      if (Platform.OS !== 'android') return;
      const sdk = Platform.Version as number;
      const perms = sdk >= 31
        ? [
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          ]
        : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
      await PermissionsAndroid.requestMultiple(perms);
    })();
    return () => stopLoop();
  }, []);

  const post = useCallback((payload: object) => {
    wv.current?.injectJavaScript(
      `window.onRNMessage && window.onRNMessage(${JSON.stringify(payload)});true;`,
    );
  }, []);

  const startLoop = useCallback((dev: BluetoothDevice) => {
    stopLoop();
    loopRef.current = setInterval(async () => {
      try {
        const data = await pollPIDs(dev);
        errCount.current = 0;
        post({type: 'LIVE_DATA', ...data});
      } catch {
        errCount.current++;
        // Après 5 erreurs consécutives → connexion perdue
        if (errCount.current >= 5) {
          stopLoop();
          devRef.current = null;
          post({type: 'DISCONNECTED', unexpected: true});
        }
      }
    }, 300);
  }, [post]);

  const doScan = useCallback(async () => {
    try {
      const on = await RNBluetoothClassic.isBluetoothEnabled();
      if (!on) await RNBluetoothClassic.requestBluetoothEnabled();
      const paired = await RNBluetoothClassic.getBondedDevices();
      post({
        type: 'SCAN_RESULT',
        devices: paired.map(d => ({name: d.name ?? d.address, address: d.address})),
      });
    } catch (e: any) {
      post({type: 'SCAN_ERROR', message: e.message ?? 'Erreur scan Bluetooth'});
    }
  }, [post]);

  const doConnect = useCallback(async (address: string) => {
    try {
      post({type: 'CONNECTING'});
      const dev = await RNBluetoothClassic.connectToDevice(address, {delimiter: '\r'});
      devRef.current = dev;
      errCount.current = 0;

      // Init ELM327 — ISO 9141-2 / KWP2000
      const initCmds = ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP4', 'ATST19'];
      for (const cmd of initCmds) {
        await dev.write(cmd + '\r');
        await delay(cmd === 'ATZ' ? 1500 : 250);
        try { await dev.read(); } catch {}
      }
      // Délai supplémentaire après init pour que l'ECU soit prêt
      await delay(500);

      post({type: 'CONNECTED', name: dev.name ?? address});
      startLoop(dev);
    } catch (e: any) {
      post({type: 'CONNECT_ERROR', message: e.message ?? 'Connexion échouée'});
    }
  }, [post, startLoop]);

  const doDisconnect = useCallback(async () => {
    stopLoop();
    try { await devRef.current?.disconnect(); } catch {}
    devRef.current = null;
    post({type: 'DISCONNECTED', unexpected: false});
  }, [post]);

  const doCmd = useCallback(async (cmd: string, tag: string) => {
    if (!devRef.current) return;
    if (!isValidObdCmd(cmd)) return;
    try {
      await devRef.current.write(cmd + '\r');
      await delay(400);
      const r = await devRef.current.read();
      post({type: 'CMD_RESPONSE', tag, data: r ?? ''});
    } catch (e: any) {
      post({type: 'CMD_ERROR', tag, message: e.message});
    }
  }, [post]);

  const stopLoop = () => {
    if (loopRef.current) {
      clearInterval(loopRef.current);
      loopRef.current = null;
    }
  };

  // ── Parser robuste ELM327 ──────────────────────────────────────────────
  const pollPIDs = async (dev: BluetoothDevice) => {

    // Envoie une commande et retourne la réponse nettoyée
    const send = async (cmd: string): Promise<string> => {
      await dev.write('01 ' + cmd + '\r');
      await delay(100);
      const raw = (await dev.read()) ?? '';
      return raw;
    };

    // Temp huile — PID 0x5C (optionnel, souvent absent sur Golf 4 TDi)
    let oil: number | null = null;
    try {
      oil = parseOil(await send('5C'));
    } catch {}

    return {
      rpm:      parseRpm(await send('0C')),
      speed:    parseSpeed(await send('0D')),
      coolant:  parseCoolant(await send('05')),
      load:     parseLoad(await send('04')),
      thr:      parseThrottle(await send('11')),
      map:      parseMap(await send('0B')),
      intake:   parseIntake(await send('0F')),
      o2:       parseO2(await send('14')),
      battVolt: parseBattVolt(await send('42')),
      oil,
    };
  };

  const onMsg = useCallback(
    (e: {nativeEvent: {data: string}}) => {
      try {
        const raw: unknown = JSON.parse(e.nativeEvent.data);
        if (!isValidWVMsg(raw)) return;
        const m = raw;
        if (m.type === 'SCAN')       doScan();
        if (m.type === 'CONNECT')    doConnect(m.address);
        if (m.type === 'DISCONNECT') doDisconnect();
        if (m.type === 'SEND_CMD')   doCmd(m.cmd, m.tag);
      } catch {}
    },
    [doScan, doConnect, doDisconnect, doCmd],
  );

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" translucent={false} />
      <WebView
        ref={wv}
        source={{html: APP_HTML}}
        style={s.wv}
        onMessage={onMsg}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['file://*']}
        scalesPageToFit={false}
        textZoom={100}
        mixedContentMode="never"
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000000'},
  wv:   {flex: 1, backgroundColor: '#000000'},
});
