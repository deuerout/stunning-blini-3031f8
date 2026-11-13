import { SafeAreaView } from "react-native-safe-area-context";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { theme } from "@/theme";
import { sampleLicense } from "@/data/license";
import { LicenseCard } from "@/components/LicenseCard";

export default function LicenseSummaryScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>Your license</Text>
        <Text style={styles.heading}>Deverout &amp; Associates</Text>
        <Text style={styles.subheading}>Solomon Digital Data Licensing</Text>

        <View style={styles.cardSpacer}>
          <LicenseCard license={sampleLicense} />
        </View>

        <Text style={styles.note}>
          This is sample data for one test agreement, shown so this first screen has something real to look at. A
          working login and your actual account will replace it in the next step.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.parchment,
  },
  content: {
    padding: theme.spacing(5),
    paddingBottom: theme.spacing(10),
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: theme.colors.brass,
    marginBottom: theme.spacing(2),
  },
  heading: {
    fontSize: 26,
    fontWeight: "700",
    color: theme.colors.ink,
  },
  subheading: {
    fontSize: 14,
    color: theme.colors.inkSoft,
    marginTop: 2,
    marginBottom: theme.spacing(6),
  },
  cardSpacer: {
    marginBottom: theme.spacing(5),
  },
  note: {
    fontSize: 13,
    lineHeight: 19,
    color: theme.colors.muted,
  },
});
