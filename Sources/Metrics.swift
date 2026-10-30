import Foundation
import Darwin

final class Metrics {
    private let host = mach_host_self()
    private var previous: (UInt64, UInt64)?
    private(set) var latest: [String: Any] = [:]
    func sample() {
        var cpu = host_cpu_load_info_data_t()
        var cpuCount = mach_msg_type_number_t(MemoryLayout.size(ofValue: cpu) / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &cpu) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(cpuCount)) {
                host_statistics(host, HOST_CPU_LOAD_INFO, $0, &cpuCount)
            }
        }
        var percentage: Any = NSNull()
        if result == KERN_SUCCESS {
            let ticks = cpu.cpu_ticks
            let idle = UInt64(ticks.2)
            let total = UInt64(ticks.0) + UInt64(ticks.1) + idle + UInt64(ticks.3)
            if let (pTotal, pIdle) = previous, total > pTotal, idle >= pIdle {
                percentage = max(0, min(100, 100 * (1 - Double(idle - pIdle) / Double(total - pTotal))))
            }
            previous = (total, idle)
        }
        var vm = vm_statistics64_data_t()
        var vmCount = mach_msg_type_number_t(MemoryLayout.size(ofValue: vm) / MemoryLayout<integer_t>.size)
        let vmResult = withUnsafeMutablePointer(to: &vm) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(vmCount)) {
                host_statistics64(host, HOST_VM_INFO64, $0, &vmCount)
            }
        }
        let ram = ProcessInfo.processInfo.physicalMemory
        let used = min(ram, (UInt64(vm.active_count) + UInt64(vm.wire_count) + UInt64(vm.compressor_page_count)) * UInt64(vm_kernel_page_size))
        var disk = statfs()
        let dataPath = FileManager.default.fileExists(atPath: "/System/Volumes/Data") ? "/System/Volumes/Data" : "/"
        let diskOK = statfs(dataPath, &disk) == 0
        let total = disk.f_blocks * UInt64(max(0, disk.f_bsize))
        let free = min(total, disk.f_bavail * UInt64(max(0, disk.f_bsize)))
        latest = ["sampledAt": Date().timeIntervalSince1970,
                  "cpu": ["percent": percentage, "cores": ProcessInfo.processInfo.activeProcessorCount],
                  "memory": ["used": vmResult == KERN_SUCCESS ? used as Any : NSNull(), "total": ram],
                  "disk": ["used": diskOK ? (total - free) as Any : NSNull(), "total": total, "path": dataPath]]
    }
    deinit { mach_port_deallocate(mach_task_self_, host) }
}
