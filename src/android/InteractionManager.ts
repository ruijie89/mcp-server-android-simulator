import {exec, spawn} from 'child_process';
import {promisify} from 'util';

import {
	AndroidPaths,
	CreateAVDArgs,
	EmulatorDevice,
	EmulatorInfo,
	LaunchAppArgs,
	ScreenSize,
	SDKList,
	SDKPackage,
	StartEmulatorArgs,
	SwipeDirection,
} from './types';
import {error} from 'console';

const execAsync = promisify(exec);

export class InteractionManager {
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

	async swipe(port: string, direction: SwipeDirection): Promise<string> {
		const screenSize = await this.getScreenSize(port);
		const centerX = screenSize.width >> 1;
		const centerY = screenSize.height >> 1;

		let x0: number, y0: number, x1: number, y1: number;
		const duration = 200; //milliseconds

		switch (direction) {
			case 'up':
				x0 = x1 = centerX;
				y0 = Math.floor(screenSize.height * 0.8);
				y1 = Math.floor(screenSize.height * 0.2);
				break;
			case 'down':
				x0 = x1 = centerX;
				y0 = Math.floor(screenSize.height * 0.2);
				y1 = Math.floor(screenSize.height * 0.8);
				break;
			case 'left':
				y0 = y1 = centerY;
				x0 = Math.floor(screenSize.width * 0.8);
				x1 = Math.floor(screenSize.width * 0.2);
				break;
			case 'right':
				y0 = y1 = centerY;
				x0 = Math.floor(screenSize.width * 0.2);
				x1 = Math.floor(screenSize.width * 0.8);
				break;
			default:
				throw new Error(
					`Swipe direction "${direction}" is not supported`,
				);
		}

		try {
			await execAsync(
				`${this.androidPaths.adb} -s emulator-${port} shell input swipe ${x0} ${y0} ${x1} ${y1} ${duration}`,
				{
					env: this.getAndroidEnv(),
				},
			);
			return `Emulator on port ${port} has been swiped.`;
		} catch (error) {
			throw new Error(
				`Failed to swipe emulator: ${
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

	private async getScreenSize(port: string): Promise<ScreenSize> {
		const {stdout} = await execAsync(
			`${this.androidPaths.adb} -s emulator-${port} shell wm size`,
			{
				env: this.getAndroidEnv(),
			},
		);

		const match = stdout.match(/Physical size:\s*(\d+)x(\d+)/);
		if (match) {
			const scale = 1;
			const width = parseInt(match[1], 10);
			const height = parseInt(match[2], 10);
			console.log(`Width: ${width}, Height: ${height}`);

			return {width, height, scale};
		} else {
			throw new Error('Failed to get screen size');
		}
	}
}
