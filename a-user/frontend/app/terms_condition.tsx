import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTerms } from "./termContext";

// ---------------------------------------------------------------------------
// Terms and Conditions data
// Keeping this as a plain array of sections makes it easy to update the
// content later without touching any of the layout/render logic below.
// ---------------------------------------------------------------------------
type Clause = string;

type Section = {
  title: string;
  intro?: string;
  clauses?: Clause[];
  outro?: string;
};

const EFFECTIVE_DATE = "October 2026";

const SECTIONS: Section[] = [
  {
    title: "1. Eligibility",
    intro:
      "Only registered households approved by the Barangay Administrator are permitted to use the system. Each approved household shall be assigned a unique RFID tag that serves as its official identifier for all waste disposal activities.",
    outro:
      "Users are responsible for ensuring that the information provided during registration is accurate, complete, and up to date. The Barangay reserves the right to reject or suspend registrations containing false or misleading information.",
  },
  {
    title: "2. RFID Usage",
    intro:
      "Each RFID tag is unique and intended solely for the registered household to which it was assigned.\n\nUsers agree to:",
    clauses: [
      "Use only their assigned RFID tag.",
      "Keep their RFID tag secure and prevent unauthorized use.",
      "Immediately report any lost, damaged, or stolen RFID tag to the Barangay Administrator.",
    ],
    outro:
      "The use of another household's RFID tag or any attempt to manipulate the identification process is strictly prohibited.",
  },
  {
    title: "3. Waste Segregation Responsibilities",
    intro:
      "Households are expected to properly segregate waste in accordance with the waste segregation guidelines established by the Barangay and Republic Act No. 9003.\n\nThe system currently accepts only the designated waste categories supported by the Smart Bin. Disposal of prohibited, hazardous, medical, electronic, or other unauthorized waste is not permitted.",
    outro:
      "Improper segregation may result in point deductions, rejection of rewards, or administrative actions determined by the Barangay.",
  },
  {
    title: "4. Disposal Monitoring",
    intro:
      "Every disposal activity may be recorded by the system, including but not limited to:",
    clauses: [
      "Household identification through RFID authentication.",
      "Date and time of disposal.",
      "Assigned counter-stamp reference.",
      "Disposal history.",
      "Compliance status.",
      "Reward or penalty transactions.",
    ],
    outro:
      "These records are maintained to support accountability, reporting, and the improvement of barangay waste management programs.",
  },
  {
    title: "5. Rewards and Points",
    intro:
      "The Reward Management feature is intended to encourage consistent compliance with proper waste segregation practices.\n\nPoints may be earned through verified compliant disposal activities and may be deducted for violations based on the rules established by the Barangay Administrator.\n\nReward availability, redemption requirements, point values, and redemption procedures are subject to change without prior notice depending on barangay policies, available resources, or program requirements.\n\nPoints:",
    clauses: [
      "Have no monetary value.",
      "Are non-transferable.",
      "Cannot be exchanged for cash.",
      "May expire or be adjusted when required by the Barangay.",
    ],
    outro:
      "The Barangay reserves the right to deny or cancel rewards obtained through fraudulent activities or system abuse.",
  },
  {
    title: "6. User Conduct",
    intro: "Users agree not to:",
    clauses: [
      "Submit false registration information.",
      "Share or lend RFID tags to other households.",
      "Attempt to manipulate the reward system.",
      "Damage or tamper with any Smart Bin hardware.",
      "Interfere with the operation of the system.",
      "Perform any activity intended to gain unfair rewards or disrupt normal system operations.",
    ],
    outro:
      "Any violation may result in account suspension, reward forfeiture, or permanent removal from the program, subject to Barangay evaluation.",
  },
  {
    title: "7. Administrator Rights",
    intro: "Authorized Barangay personnel may:",
    clauses: [
      "Verify household registrations.",
      "Approve or reject account requests.",
      "Assign RFID tags.",
      "Configure reward and penalty rules.",
      "Review disposal records.",
      "Monitor compliance.",
      "Suspend accounts that violate these Terms and Conditions.",
    ],
    outro:
      "Administrative decisions related to community waste management shall be considered final unless otherwise provided by applicable barangay policies.",
  },
  {
    title: "8. Privacy and Data Protection",
    intro:
      "The system collects only the information necessary to support household identification, waste disposal monitoring, reward management, and system administration.\n\nCollected information shall be processed in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173) and shall only be accessed by authorized personnel for legitimate waste management purposes.",
    outro:
      "The system does not sell or disclose personal information to unauthorized third parties except when required by law.",
  },
  {
    title: "9. System Availability",
    intro:
      "While reasonable efforts are made to ensure continuous operation, the Smart Bin Waste Management with Segregation and Rewarding System may experience temporary interruptions due to:",
    clauses: [
      "Scheduled maintenance",
      "Software updates",
      "Hardware servicing",
      "Network connectivity issues",
      "Power interruptions",
      "Technical failures beyond reasonable control",
    ],
    outro:
      "The Barangay shall not be held liable for temporary service interruptions resulting from these circumstances.",
  },
  {
    title: "10. Limitation of Liability",
    intro:
      "The system is designed to support barangay waste management operations and encourage responsible waste segregation. While it assists in monitoring household participation, it does not replace existing barangay ordinances or legal enforcement procedures.",
    outro:
      "The developers and Barangay shall not be liable for losses, damages, or claims arising from misuse of the system, unauthorized access resulting from user negligence, or technical issues beyond reasonable control.",
  },
  {
    title: "11. Amendments",
    intro:
      "The Barangay reserves the right to modify these Terms and Conditions whenever necessary to improve system operations, comply with applicable laws, or support changes in waste management policies.",
    outro:
      "Continued use of the system after such modifications constitutes acceptance of the updated Terms and Conditions.",
  },
  {
    title: "12. Acceptance of Terms",
    intro:
      "By registering an account, accepting an assigned RFID tag, or using any component of the Smart Bin Waste Management with Segregation and Rewarding System, the user confirms that they have read, understood, and agreed to comply with these Terms and Conditions.",
  },
];

// ---------------------------------------------------------------------------
// Reusable section renderer
// ---------------------------------------------------------------------------
function TermsSection({ section }: { section: Section }) {
  return (
    <View className="mb-6">
      <Text className="text-base font-bold text-gray-900 mb-2">
        {section.title}
      </Text>

      {section.intro
        ?.split("\n\n")
        .map((para, idx) => (
          <Text
            key={`intro-${idx}`}
            className="text-sm leading-6 text-gray-700 mb-2"
          >
            {para}
          </Text>
        ))}

      {section.clauses && (
        <View className="mb-2 pl-1">
          {section.clauses.map((clause, idx) => (
            <View key={idx} className="flex-row mb-1.5 pr-2">
              <Text className="text-sm text-gray-700 mr-2">{"\u2022"}</Text>
              <Text className="flex-1 text-sm leading-6 text-gray-700">
                {clause}
              </Text>
            </View>
          ))}
        </View>
      )}

      {section.outro && (
        <Text className="text-sm leading-6 text-gray-700">
          {section.outro}
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
type Props = {
  // When true, shows an "I Agree" footer that stores acceptance and
  // navigates to /login. When false (default), renders as a plain
  // read-only page (e.g. when opened later from Settings) with just a
  // back header and no footer button.
  requireAcceptance?: boolean;
};

export default function TermsAndConditionsScreen({
  requireAcceptance = true,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const { markAccepted } = useTerms();

  const handleAgree = async () => {
    try {
      setSubmitting(true);
      // Updates the SAME shared state that _layout.tsx's redirect effect
      // reads — this is what prevents the bounce-back-to-terms bug.
      await markAccepted();
      router.replace("/");
    } catch (err) {
      console.error("Failed to save terms acceptance:", err);
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
      {/* Floating back button — only shown when opened as a normal page
          (e.g. from Settings), not during the mandatory first-run gate */}
      {!requireAcceptance && (
        <View className="px-4 pt-2">
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            className="w-9 h-9 rounded-full bg-gray-100 items-center justify-center active:opacity-70"
          >
            <Ionicons name="arrow-back" size={20} color="#111827" />
          </Pressable>
        </View>
      )}

      {/* Content */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: requireAcceptance ? 24 : 8,
          paddingBottom: 32,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Icon badge */}
       
        <Text className="text-2xl font-bold text-gray-900 mb-1">
          Terms & Conditions
        </Text>
        <Text className="text-xs font-medium text-gray-400 mb-5">
          Effective {EFFECTIVE_DATE}
        </Text>

        <View className="h-px bg-gray-100 mb-5" />

        <Text className="text-sm leading-6 text-gray-600 mb-7">
          Welcome to the Smart Bin Waste Management with Segregation and
          Rewarding System. By registering for an account, using the mobile
          application, accessing the web platform, or utilizing the Smart
          Bin, you acknowledge that you have read, understood, and agreed to
          be bound by these Terms and Conditions. These terms govern the use
          of the system and are intended to promote responsible waste
          segregation, accountability, and fair participation within the
          community.
        </Text>

        {SECTIONS.map((section, idx) => (
          <View key={section.title}>
            <TermsSection section={section} />
            {idx < SECTIONS.length - 1 && (
              <View className="h-px bg-gray-100 mb-6 -mt-2" />
            )}
          </View>
        ))}
      </ScrollView>

      {/* Footer accept button — only shown on first-run gate */}
      {requireAcceptance && (
        <View className="px-5 pt-3 pb-4 border-t border-gray-100 bg-white">
          <Pressable
            onPress={handleAgree}
            disabled={submitting}
            className="bg-green-600 rounded-2xl py-4 items-center flex-row justify-center active:opacity-80"
            style={{
              shadowColor: "#1cb855",
              shadowOpacity: 0.25,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 3,
            }}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                
                <Text className="text-white font-semibold text-base">
                  I Agree, Continue to Login
                </Text>
              </>
            )}
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}