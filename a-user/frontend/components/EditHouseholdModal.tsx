import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface EditHouseholdProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function EditHousehold({ isOpen, onClose }: EditHouseholdProps) {

  return (
    <Modal
      visible={isOpen}
      className="bg-white"
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        {/* Overlay */}
        <Pressable
          className="flex-1 bg-black/40 justify-center items-center p-4"
          onPress={onClose}
        >
          {/* Prevent closing when clicking inside modal */}
          <Pressable
            className="bg-white w-full max-w-lg max-h-[90%] rounded-2xl overflow-hidden"
            onPress={() => {}}
          >

            {/* HEADER */}
            <View className="flex-row justify-between items-center px-6 py-4 border-b border-gray-200">
              <Text className="text-lg font-bold">
                Update Household Information
              </Text>

              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close" size={22} color="gray" />
              </TouchableOpacity>
            </View>

            <ScrollView
              className="p-5"
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={{ paddingBottom: 24 }}
            >

              {/* Fullname */}
              <View className="mb-3">
                <View className="flex-row items-center">
                  <Text className="text-lg font-semibold">Fullname</Text>
                  <Text className="text-red-500 ml-1">*</Text>
                </View>
                <TextInput
                  placeholder="ex. Janice S. Dela Cruz.."
                  className="border rounded-lg px-3 py-2 mt-1"
                />
              </View>

              {/* Family Member */}
              <View className="mb-3">
                <Text className="text-lg font-semibold">
                  Family Member
                </Text>
                <TextInput
                  placeholder="ex. 5.."
                  keyboardType="numeric"
                  className="border rounded-lg px-3 py-2 mt-1"
                />
              </View>

              {/* Address */}
              <View className="mb-3">
                <View className="flex-row items-center">
                  <Text className="text-lg font-semibold">
                    Address
                  </Text>
                  <Text className="text-red-500 ml-1">*</Text>
                </View>

                <View className="ml-3 mt-2">

                  {/* House No */}
                  <View className="mb-2">
                    <View className="flex-row items-center">
                      <Text className="font-semibold">
                        House No.
                      </Text>
                      <Text className="text-red-500 ml-1">*</Text>
                    </View>
                    <TextInput
                      placeholder="ex. 0123.."
                      className="border rounded-lg px-3 py-2 mt-1"
                    />
                  </View>

                  {/* Street */}
                  <View>
                    <View className="flex-row items-center">
                      <Text className="font-semibold">
                        Street/Avenue/Block
                      </Text>
                      <Text className="text-red-500 ml-1">*</Text>
                    </View>
                    <TextInput
                      placeholder="ex. Rizal St.."
                      className="border rounded-lg px-3 py-2 mt-1"
                    />
                  </View>

                </View>
              </View>

              {/* Email */}
              <View className="mb-3">
                <Text className="text-lg font-semibold">
                  Email
                </Text>
                <TextInput
                  placeholder="ex. janicedelacruz@gmail.com.."
                  keyboardType="email-address"
                  autoCapitalize="none"
                  className="border rounded-lg px-3 py-2 mt-1"
                />
              </View>

              {/* Button */}
              <TouchableOpacity
                className="mt-5 bg-green-600 rounded-lg p-3 items-center"
                activeOpacity={0.8}
              >
                <Text className="text-white font-semibold">
                  Update Information
                </Text>
              </TouchableOpacity>

            </ScrollView>

          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}