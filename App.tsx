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

// HTML dans un fichier .js separe — Metro compile chaque fichier independamment
// Evite les problemes de template literals imbriques et d'encodage
const APP_HTML: string = require('./AppHtml.js');


type WVMsg =
  | {type: 'SCAN'}
  | {type: 'CONNECT'; address: string}
  | {type: 'DISCONNECT'}
  | {type: 'SEND_CMD'; cmd: string; tag: string};

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
        try { await dev.read(); } catch (_) {}
      }
      // Délai supplémentaire après init pour que l'ECU soit prêt
      await delay(500);

      post({type: 'CONNECTED', name: dev.name ?? address});
      startLoop(dev);
    } catch (e: any) {
      post({type: 'CONNECT_ERROR', message: e.message ?? 'Connexion échouée'});
    }
  }, [post]);

  const doDisconnect = useCallback(async () => {
    stopLoop();
    try { await devRef.current?.disconnect(); } catch (_) {}
    devRef.current = null;
    post({type: 'DISCONNECTED', unexpected: false});
  }, [post]);

  const doCmd = useCallback(async (cmd: string, tag: string) => {
    if (!devRef.current) return;
    try {
      await devRef.current.write(cmd + '\r');
      await delay(400);
      const r = await devRef.current.read();
      post({type: 'CMD_RESPONSE', tag, data: r ?? ''});
    } catch (e: any) {
      post({type: 'CMD_ERROR', tag, message: e.message});
    }
  }, [post]);

  const startLoop = useCallback((dev: BluetoothDevice) => {
    stopLoop();
    loopRef.current = setInterval(async () => {
      try {
        const data = await pollPIDs(dev);
        errCount.current = 0;
        post({type: 'LIVE_DATA', ...data});
      } catch (e) {
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

    // Valide la réponse : doit contenir au moins N octets hex utilisables
    // Une réponse ELM327 valide ressemble à : "41 0C 1A F0\r" ou "410C1AF0"
    const isValid = (raw: string, minBytes: number = 1): boolean => {
      if (!raw) return false;
      const upper = raw.toUpperCase();
      // Rejeter toutes les erreurs ELM327
      if (upper.includes('NO DATA')) return false;
      if (upper.includes('UNABLE')) return false;
      if (upper.includes('ERROR'))  return false;
      if (upper.includes('STOPPED')) return false;
      if (upper.includes('BUS'))    return false;
      if (upper.includes('?'))      return false;
      // Extraire les octets hex
      const bytes = upper.replace(/[^0-9A-F]/g, '');
      return bytes.length >= (minBytes + 2) * 2; // +2 pour les bytes d'en-tête (mode+PID)
    };

    // Extraire les octets de données (après les 2 bytes mode+PID)
    const dataBytes = (raw: string): number[] => {
      const hex = raw.toUpperCase().replace(/[^0-9A-F]/g, '');
      // Sauter les 2 premiers bytes (ex: "410C" = mode 41, PID 0C)
      const result: number[] = [];
      for (let i = 4; i < hex.length; i += 2) {
        const b = parseInt(hex.slice(i, i + 2), 16);
        if (!isNaN(b)) result.push(b);
      }
      return result;
    };

    // Lire les PIDs un par un avec validation
    let rpm = 0, speed = 0, coolant: number|null = null, load = 0;
    let thr = 0, map = 0, intake: number|null = null, o2 = 0;
    let battVolt = 0, oil: number|null = null;

    // RPM = ((A*256)+B)/4 — PID 0x0C
    const rpmRaw = await send('0C');
    if (isValid(rpmRaw, 2)) {
      const b = dataBytes(rpmRaw);
      if (b.length >= 2) rpm = Math.round(((b[0] * 256) + b[1]) / 4);
    }

    // Vitesse — PID 0x0D
    const speedRaw = await send('0D');
    if (isValid(speedRaw, 1)) {
      const b = dataBytes(speedRaw);
      if (b.length >= 1) speed = b[0];
    }

    // Temp eau — PID 0x05 — A-40 (valeur brute 0 = -40°C → invalide)
    const coolRaw = await send('05');
    if (isValid(coolRaw, 1)) {
      const b = dataBytes(coolRaw);
      if (b.length >= 1 && b[0] > 0) coolant = b[0] - 40;
    }

    // Charge — PID 0x04
    const loadRaw = await send('04');
    if (isValid(loadRaw, 1)) {
      const b = dataBytes(loadRaw);
      if (b.length >= 1) load = Math.round(b[0] * 100 / 255);
    }

    // Papillon — PID 0x11
    const thrRaw = await send('11');
    if (isValid(thrRaw, 1)) {
      const b = dataBytes(thrRaw);
      if (b.length >= 1) thr = Math.round(b[0] * 100 / 255);
    }

    // MAP — PID 0x0B
    const mapRaw = await send('0B');
    if (isValid(mapRaw, 1)) {
      const b = dataBytes(mapRaw);
      if (b.length >= 1) map = b[0];
    }

    // Temp admission — PID 0x0F — même filtre que temp eau
    const intakeRaw = await send('0F');
    if (isValid(intakeRaw, 1)) {
      const b = dataBytes(intakeRaw);
      if (b.length >= 1 && b[0] > 0) intake = b[0] - 40;
    }

    // O2 B1S1 — PID 0x14
    const o2Raw = await send('14');
    if (isValid(o2Raw, 1)) {
      const b = dataBytes(o2Raw);
      if (b.length >= 1) o2 = b[0] * 0.005;
    }

    // Tension batterie — PID 0x42 — ((A*256)+B)/1000
    const battRaw = await send('42');
    if (isValid(battRaw, 2)) {
      const b = dataBytes(battRaw);
      if (b.length >= 2) {
        const v = ((b[0] * 256) + b[1]) / 1000;
        if (v > 6 && v < 20) battVolt = v; // sanity check
      }
    }

    // Temp huile — PID 0x5C (optionnel, souvent absent sur Golf 4 TDi)
    try {
      const oilRaw = await send('5C');
      if (isValid(oilRaw, 1)) {
        const b = dataBytes(oilRaw);
        if (b.length >= 1 && b[0] > 0) oil = b[0] - 40;
      }
    } catch (_) {}

    return {
      rpm,
      speed,
      coolant: coolant ?? null,   // null = non disponible → HTML affiche '--'
      load,
      thr,
      map,
      intake: intake ?? null,
      o2,
      battVolt,
      oil: oil ?? null,
    };
  };

  const onMsg = useCallback(
    (e: {nativeEvent: {data: string}}) => {
      try {
        const m: WVMsg = JSON.parse(e.nativeEvent.data);
        if (m.type === 'SCAN')       doScan();
        if (m.type === 'CONNECT')    doConnect(m.address);
        if (m.type === 'DISCONNECT') doDisconnect();
        if (m.type === 'SEND_CMD')   doCmd(m.cmd, m.tag);
      } catch (_) {}
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
        originWhitelist={['*']}
        scalesPageToFit={false}
        textZoom={100}
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        mixedContentMode="always"
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000000'},
  wv:   {flex: 1, backgroundColor: '#000000'},
});
