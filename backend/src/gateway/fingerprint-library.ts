import { DeviceProfile, GatewayPlatform } from "./contracts.js";

type FingerprintPolicy = {
  policyId: string;
  tlsClientProfile: string;
  ja3PolicyId: string;
  ja4PolicyId: string;
  h2WeightRange: [number, number];
  h2WindowRange: [number, number];
  notes: string;
};

const IOS_DEFAULT_POLICY: FingerprintPolicy = {
  policyId: "ios-cfnetwork-v1",
  tlsClientProfile: "cfnetwork-real-device",
  ja3PolicyId: "ja3-ios-cfnetwork-v1",
  ja4PolicyId: "ja4-ios-cfnetwork-v1",
  h2WeightRange: [32, 220],
  h2WindowRange: [65535, 131070],
  notes: "iOS profile mapping for CFNetwork-aligned egress",
};

const ANDROID_DEFAULT_POLICY: FingerprintPolicy = {
  policyId: "android-okhttp-v1",
  tlsClientProfile: "okhttp-real-device",
  ja3PolicyId: "ja3-android-okhttp-v1",
  ja4PolicyId: "ja4-android-okhttp-v1",
  h2WeightRange: [24, 200],
  h2WindowRange: [65535, 196605],
  notes: "Android profile mapping for OkHttp-aligned egress",
};

const normalizeModelFamily = (value: string): string => {
  const model = String(value || "").trim().toLowerCase();
  if (!model) return "default";
  if (model.includes("iphone")) return "iphone";
  if (model.includes("ipad")) return "ipad";
  if (model.includes("pixel")) return "pixel";
  if (model.includes("samsung") || model.includes("sm-")) return "samsung";
  return "default";
};

const policyByPlatformAndFamily: Record<GatewayPlatform, Record<string, FingerprintPolicy>> = {
  iOS: {
    default: IOS_DEFAULT_POLICY,
    iphone: IOS_DEFAULT_POLICY,
    ipad: {
      ...IOS_DEFAULT_POLICY,
      policyId: "ios-ipad-cfnetwork-v1",
      ja3PolicyId: "ja3-ios-ipad-cfnetwork-v1",
      ja4PolicyId: "ja4-ios-ipad-cfnetwork-v1",
      notes: "iPad profile mapping for CFNetwork-aligned egress",
    },
  },
  Android: {
    default: ANDROID_DEFAULT_POLICY,
    pixel: ANDROID_DEFAULT_POLICY,
    samsung: {
      ...ANDROID_DEFAULT_POLICY,
      policyId: "android-samsung-okhttp-v1",
      ja3PolicyId: "ja3-android-samsung-okhttp-v1",
      ja4PolicyId: "ja4-android-samsung-okhttp-v1",
      notes: "Samsung profile mapping for OkHttp-aligned egress",
    },
  },
};

export const resolveFingerprintPolicy = (input: {
  platform: GatewayPlatform;
  profile: DeviceProfile;
}) => {
  const family = normalizeModelFamily(String(input.profile.model || ""));
  const platformPolicies = policyByPlatformAndFamily[input.platform];
  return platformPolicies[family] || platformPolicies.default;
};

