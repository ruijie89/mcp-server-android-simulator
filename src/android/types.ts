export interface EmulatorDevice {
    name: string;
    target: string;
    sdk: string;
    abi: string;
}

export interface AndroidPaths {
    avdManager: string;
    emulator: string;
    adb: string;
    sdkmanager: string;
}

export interface SDKPackage {
    path: string;
    description: string;
    version: string;
    installed: boolean;
}

export interface SDKList {
    installed: SDKPackage[];
    available: SDKPackage[];
}

export interface CreateAVDArgs {
    name: string;
    package: string;
    device?: string;
}

export interface StartEmulatorArgs {
    avd_name: string;
    cold_boot?: boolean;
    wipe_data?: boolean;
    gpu?: string;
    port?: number;
}

export interface EmulatorInfo {
    port: string;
    build_version: string;
    api_level: string;
    device_name: string;
    manufacturer: string;
    architecture: string;
}

export interface LaunchAppArgs {
    port: string;
    package_name: string;
}
