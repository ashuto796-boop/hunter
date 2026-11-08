// AURUM for iPhone: the AURUM website in a full-screen native shell. The interface and the
// AI live on the web, so every update of the site reaches the app without a new build.
// The shell adds what Safari cannot: a real app icon and launch screen, native haptics,
// external links opened in Safari, and a clean offline screen.
import { useCallback, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import * as SplashScreen from "expo-splash-screen";
import { WebView, WebViewMessageEvent } from "react-native-webview";

const SITE = "https://ashuto796-boop.github.io/hunter/gold/";
const BG = "#030508";
const ACCENT = "#2de2ff";

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 350 });

// Runs before the page: tells it that it lives inside the app
const BRIDGE = `window.AURUM_NATIVE = { platform: "ios", version: 1 }; true;`;

function haptic(style: string | undefined) {
  if (style === "success") return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  if (style === "warning") return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  if (style === "error") return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  if (style === "select") return Haptics.selectionAsync();
  const impact = style === "heavy" ? Haptics.ImpactFeedbackStyle.Heavy : style === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light;
  return Haptics.impactAsync(impact);
}

function Offline({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.offline}>
      <Text style={styles.word}>AURUM</Text>
      <Text style={styles.line}>Pas de connexion pour l’instant.</Text>
      <Text style={styles.sub}>L’IA continue de veiller sur l’or depuis son serveur. Reviens dès que le réseau est là.</Text>
      <Pressable style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]} onPress={onRetry}>
        <Text style={styles.retryText}>RÉESSAYER</Text>
      </Pressable>
    </View>
  );
}

export default function App() {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const shown = useRef(false);
  const reveal = useCallback(() => {
    if (shown.current) return;
    shown.current = true;
    SplashScreen.hide();
  }, []);
  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as { type?: string; style?: string };
      if (msg.type === "haptic") haptic(msg.style).catch(() => undefined);
    } catch {
      /* not one of ours */
    }
  };
  const external = (url: string) => {
    Linking.openURL(url).catch(() => undefined);
  };
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {failed ? (
        <Offline
          onRetry={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        />
      ) : (
        <WebView
          key={attempt}
          source={{ uri: SITE }}
          style={styles.root}
          containerStyle={styles.root}
          injectedJavaScriptBeforeContentLoaded={BRIDGE}
          onMessage={onMessage}
          onLoadEnd={reveal}
          onError={() => {
            setFailed(true);
            reveal();
          }}
          onHttpError={(e) => {
            if (e.nativeEvent.statusCode >= 500) setFailed(true);
          }}
          onContentProcessDidTerminate={() => setAttempt((n) => n + 1)}
          // links to other sites (GitHub settings, OANDA, press articles) open in Safari
          onShouldStartLoadWithRequest={(req) => {
            if (!req.isTopFrame || req.url.startsWith(SITE) || req.url.startsWith("about:") || req.url.startsWith("data:")) return true;
            external(req.url);
            return false;
          }}
          onOpenWindow={(e) => external(e.nativeEvent.targetUrl)}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          bounces={false}
          allowsBackForwardNavigationGestures={false}
          allowsLinkPreview={false}
          sharedCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={["https://*"]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  offline: { flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center", padding: 32 },
  word: { color: "#fff", fontSize: 56, fontStyle: "italic", fontFamily: "Georgia", letterSpacing: 4, marginBottom: 18 },
  line: { color: "#fff", fontSize: 20, fontStyle: "italic", fontFamily: "Georgia", textAlign: "center" },
  sub: { color: "rgba(255,255,255,0.55)", fontSize: 14, textAlign: "center", marginTop: 10, lineHeight: 20 },
  retry: { marginTop: 28, borderWidth: 1, borderColor: ACCENT, borderRadius: 6, paddingVertical: 12, paddingHorizontal: 26 },
  retryText: { color: ACCENT, fontSize: 13, letterSpacing: 2, fontWeight: "600" },
});
