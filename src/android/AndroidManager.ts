import { exec, spawn } from 'child_process';
import { promisify } from 'util';

import {
	AndroidPaths,
	CreateAVDArgs,
	EmulatorDevice,
	EmulatorInfo,
	LaunchAppArgs,
	SDKList,
	SDKPackage,
	StartEmulatorArgs,
} from './types';

const execAsync = promisify(exec);

export class AndroidManager {
    private androidHome: string;
    private androidPaths: AndroidPaths;

    constructor() {
        const defaultAndroidHome = `${process.env.HOME}/Library/Android/sdk`;
        this.androidHome = process.env.ANDROID_HOME || defaultAndroidHome;

        // Verify Android SDK installation
        if (!this.androidHome) {
            throw new Error(
                'ANDROID_HOME environment variable is not set and default path not found',
            );
        }

        this.androidPaths = {
            avdManager: `${this.androidHome}/cmdline-tools/latest/bin/avdmanager`,
            emulator: `${this.androidHome}/emulator/emulator`,
            adb: `${this.androidHome}/platform-tools/adb`,
            sdkmanager: `${this.androidHome}/cmdline-tools/latest/bin/sdkmanager`,
        };

        // Log SDK paths for debugging
        console.error('Android SDK paths:', {
            ANDROID_HOME: this.androidHome,
            ...this.androidPaths,
        });
    }

    private getAndroidEnv(): NodeJS.ProcessEnv {
        return {
            ...process.env,
            ANDROID_HOME: this.androidHome,
            PATH: `${this.androidHome}/platform-tools:${this.androidHome}/cmdline-tools/latest/bin:${this.androidHome}/emulator:${process.env.PATH}`,
        };
    }

    async listEmulators(): Promise<string> {
        const emulators = await this.getEmulators();
        return emulators
            .map(
                (emulator) =>
                    `${emulator.name} (Target: ${emulator.target}, ABI: ${emulator.abi})`,
            )
            .join('\n');
    }

    async startEmulator(args: StartEmulatorArgs): Promise<string> {
        const {
            avd_name,
            cold_boot = false,
            wipe_data = false,
            gpu,
            port,
        } = args;

        try {
            const emulatorArgs = [
                '-avd',
                avd_name,
                ...(cold_boot ? ['-no-snapshot-load'] : []),
                ...(wipe_data ? ['-wipe-data'] : []),
                ...(gpu ? ['-gpu', gpu] : []),
                ...(port ? ['-port', port.toString()] : []),
            ];

            const child = spawn(this.androidPaths.emulator, emulatorArgs, {
                detached: true,
                stdio: 'ignore',
                env: this.getAndroidEnv(),
            });

            child.unref();

            return `Starting emulator "${avd_name}"... It may take a few moments to fully boot.`;
        } catch (error) {
            throw new Error(
                `Failed to start emulator: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }`,
            );
        }
    }

    async stopEmulator(port: string): Promise<string> {
        try {
            await execAsync(
                `${this.androidPaths.adb} -s emulator-${port} emu kill`,
                {
                    env: this.getAndroidEnv(),
                },
            );
            return `Emulator on port ${port} has been stopped.`;
        } catch (error) {
            throw new Error(
                `Failed to stop emulator: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }`,
            );
        }
    }

    async listRunningEmulators(): Promise<string> {
        const running = await this.getRunningEmulators();
        const runningList = running
            .map((device) => `${device.name} (Port: ${device.port})`)
            .join('\n');

        return runningList
            ? `Running Emulators:\n${runningList}`
            : 'No emulators currently running.';
    }

    async createAVD(args: CreateAVDArgs): Promise<string> {
        const {name, package: pkg, device} = args;

        try {
            const avdArgs = [
                'create',
                'avd',
                '-n',
                name,
                '-k',
                `"${pkg}"`,
                ...(device ? ['-d', device] : []),
            ];

            const {stdout} = await execAsync(
                `${this.androidPaths.avdManager} ${avdArgs.join(' ')}`,
                {
                    env: this.getAndroidEnv(),
                },
            );

            return `AVD "${name}" created successfully.\n${stdout}`;
        } catch (error) {
            throw new Error(
                `Failed to create AVD: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }`,
            );
        }
    }

    async getEmulatorInfo(port: string): Promise<EmulatorInfo> {
        try {
            const {stdout} = await execAsync(
                `${this.androidPaths.adb} -s emulator-${port} shell getprop`,
                {
                    env: this.getAndroidEnv(),
                },
            );
            const lines = stdout.split('\n');

            return {
                port,
                build_version: this.extractProperty(
                    lines,
                    'ro.build.version.release',
                ),
                api_level: this.extractProperty(lines, 'ro.build.version.sdk'),
                device_name: this.extractProperty(lines, 'ro.product.model'),
                manufacturer: this.extractProperty(
                    lines,
                    'ro.product.manufacturer',
                ),
                architecture: this.extractProperty(lines, 'ro.product.cpu.abi'),
            };
        } catch (error) {
            throw new Error(
                `Failed to get emulator info: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }`,
            );
        }
    }

    private async getEmulators(): Promise<EmulatorDevice[]> {
        try {
            const {stdout} = await execAsync(
                `${this.androidPaths.avdManager} list avd`,
                {
                    env: this.getAndroidEnv(),
                },
            );

            const emulators: EmulatorDevice[] = [];
            const avdBlocks = stdout.split('Name: ').slice(1);

            for (const block of avdBlocks) {
                const lines = block.split('\n');
                const name = lines[0].trim();
                const target =
                    lines
                        .find((l) => l.includes('Target:'))
                        ?.split('Target: ')[1]
                        ?.trim() || 'Unknown';
                const abi =
                    lines
                        .find((l) => l.includes('ABI:'))
                        ?.split('ABI: ')[1]
                        ?.trim() || 'Unknown';

                emulators.push({
                    name,
                    target,
                    sdk: target,
                    abi,
                });
            }

            return emulators;
        } catch (error) {
            console.error('Error listing emulators:', error);
            return [];
        }
    }

    private async getRunningEmulators(): Promise<
        Array<{name: string; port: string}>
    > {
        try {
            const {stdout} = await execAsync(
                `${this.androidPaths.adb} devices`,
                {
                    env: this.getAndroidEnv(),
                },
            );
            const lines = stdout.split('\n').slice(1);
            const running = [];

            for (const line of lines) {
                if (line.includes('emulator-') && line.includes('device')) {
                    const port = line.split('emulator-')[1]?.split('\t')[0];
                    if (port) {
                        running.push({
                            name: `emulator-${port}`,
                            port: port,
                        });
                    }
                }
            }

            return running;
        } catch (error) {
            console.error('Error listing running emulators:', error);
            return [];
        }
    }

    async launchApp(args: LaunchAppArgs): Promise<string> {
        const {port, package_name} = args;

        try {
            // First check if the emulator is running
            const running = await this.getRunningEmulators();
            if (!running.some((emu) => emu.port === port)) {
                throw new Error(`No emulator running on port ${port}`);
            }

            // Check if the package exists on the device
            const {stdout: packages} = await execAsync(
                `${this.androidPaths.adb} -s emulator-${port} shell pm list packages ${package_name}`,
                {
                    env: this.getAndroidEnv(),
                },
            );

            if (!packages.includes(package_name)) {
                throw new Error(
                    `Package ${package_name} not found on emulator-${port}`,
                );
            }

            // Get the main activity of the package
            const {stdout: activities} = await execAsync(
                `${this.androidPaths.adb} -s emulator-${port} shell cmd package resolve-activity --brief ${package_name} | tail -n 1`,
                {
                    env: this.getAndroidEnv(),
                },
            );

            const activity = activities.trim();
            if (!activity) {
                throw new Error(
                    `Could not find main activity for package ${package_name}`,
                );
            }

            // Launch the app
            await execAsync(
                `${this.androidPaths.adb} -s emulator-${port} shell am start -n ${activity}`,
                {
                    env: this.getAndroidEnv(),
                },
            );

            return `Successfully launched ${package_name} on emulator-${port}`;
        } catch (error) {
            throw new Error(
                `Failed to launch app: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }`,
            );
        }
    }

    private extractProperty(lines: string[], property: string): string {
        const line = lines.find((l) => l.includes(`[${property}]`));
        return line
            ? line.split(']: [')[1]?.replace(']', '') || 'Unknown'
            : 'Unknown';
    }

    async listSDKs(): Promise<string> {
        try {
            const sdkList = await this.getSDKList();
            let output = 'Installed SDK Packages:\n';

            if (sdkList.installed.length === 0) {
                output += '  No packages installed\n';
            } else {
                output += sdkList.installed
                    .map(
                        (pkg) =>
                            `  ${pkg.path} (${pkg.version})${
                                pkg.description ? ' - ' + pkg.description : ''
                            }`,
                    )
                    .join('\n');
            }

            output += '\n\nAvailable SDK Packages:\n';
            const relevantPackages = sdkList.available.filter(
                (pkg) =>
                    pkg.path.includes('system-images;android-') ||
                    pkg.path.includes('platforms;android-') ||
                    pkg.path.includes('platform-tools') ||
                    pkg.path.includes('build-tools;') ||
                    pkg.path.includes('cmdline-tools;'),
            );

            if (relevantPackages.length === 0) {
                output += '  No relevant packages found\n';
            } else {
                output += relevantPackages
                    .map(
                        (pkg) =>
                            `  ${pkg.path} (${pkg.version})${
                                pkg.description ? ' - ' + pkg.description : ''
                            }`,
                    )
                    .join('\n');
            }

            return output;
        } catch (error) {
            return (
                `Error listing SDKs: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }\n` +
                `ANDROID_HOME: ${this.androidHome}\n` +
                'Please ensure Android SDK is properly installed and ANDROID_HOME is set correctly.'
            );
        }
    }

    private async getSDKList(): Promise<SDKList> {
        try {
            const {stdout} = await execAsync(
                `${this.androidPaths.sdkmanager} --list`,
                {
                    env: this.getAndroidEnv(),
                },
            );

            const lines = stdout.split('\n');
            const installed: SDKPackage[] = [];
            const available: SDKPackage[] = [];
            let currentSection: 'installed' | 'available' | null = null;

            for (const line of lines) {
                if (line.includes('Available Packages:')) {
                    currentSection = 'available';
                    continue;
                }

                // Skip empty lines and headers
                if (
                    !line.trim() ||
                    line.includes('---') ||
                    line.includes('Path |')
                ) {
                    continue;
                }

                // Parse installed packages (they have a different format)
                if (currentSection !== 'available') {
                    const parts = line
                        .trim()
                        .split('|')
                        .map((s) => s.trim())
                        .filter(Boolean);
                    if (parts.length >= 2) {
                        installed.push({
                            path: parts[0],
                            version: parts[1],
                            description: parts[2] || '',
                            installed: true,
                        });
                    }
                    continue;
                }

                // Parse available packages
                const parts = line
                    .trim()
                    .split('|')
                    .map((s) => s.trim())
                    .filter(Boolean);
                if (parts.length >= 2) {
                    available.push({
                        path: parts[0],
                        version: parts[1],
                        description: parts[2] || '',
                        installed: false,
                    });
                }
            }

            return {installed, available};
        } catch (error) {
            throw new Error(
                `Failed to list SDKs: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }`,
            );
        }
    }
}
