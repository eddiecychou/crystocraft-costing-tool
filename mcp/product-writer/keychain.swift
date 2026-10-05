import Foundation
import Security

let service = "com.crystocraft.operation-center.product-writer"
guard CommandLine.arguments.count == 3 else {
    fputs("Usage: keychain.swift read|write|delete <firebase-project-id>\n", stderr)
    exit(2)
}
let action = CommandLine.arguments[1]
let account = CommandLine.arguments[2]
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
]

func fail(_ status: OSStatus) -> Never {
    let message = SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)"
    fputs("Keychain: \(message)\n", stderr)
    exit(1)
}

switch action {
case "read":
    var request = query
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    guard status == errSecSuccess else { fail(status) }
    guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else { exit(1) }
    print(value, terminator: "")
case "write":
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard !data.isEmpty else { fputs("Empty credential\n", stderr); exit(2) }
    var item = query
    item[kSecValueData as String] = data
    let status = SecItemAdd(item as CFDictionary, nil)
    if status == errSecDuplicateItem {
        let updated = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        guard updated == errSecSuccess else { fail(updated) }
    } else if status != errSecSuccess { fail(status) }
case "delete":
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { fail(status) }
default:
    fputs("Unknown Keychain action\n", stderr)
    exit(2)
}
