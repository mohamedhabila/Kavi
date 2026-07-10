import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');
const iosRoot = join(repoRoot, 'ios');

function readIOSFile(path: string): string {
  return readFileSync(join(iosRoot, path), 'utf8');
}

describe('iOS durable execution bridge wiring', () => {
  it('registers BackgroundTasks before application launch completes', () => {
    const appDelegate = readIOSFile('Kavi/AppDelegate.swift');
    expect(appDelegate).toContain(
      'IOSDurableExecutionRuntime.shared.registerAtApplicationLaunch()',
    );
    expect(appDelegate.indexOf('registerAtApplicationLaunch()')).toBeLessThan(
      appDelegate.indexOf('factory.startReactNative'),
    );
  });

  it('declares only the required processing and continued-task identifiers', () => {
    const info = readIOSFile('Kavi/Info.plist');
    expect(info).toContain('<string>processing</string>');
    expect(info).toContain('<string>$(PRODUCT_BUNDLE_IDENTIFIER).durable-processing</string>');
    expect(info).toContain('<string>$(PRODUCT_BUNDLE_IDENTIFIER).durable-continuation.*</string>');
  });

  it('maps user and deferrable work to the correct APIs without GPU entitlement', () => {
    const scheduler = readIOSFile('Kavi/DurableExecution/IOSBackgroundTaskScheduler.swift');
    const entitlements = readIOSFile('Kavi/Kavi.entitlements');
    expect(scheduler).toContain('BGContinuedProcessingTaskRequest(');
    expect(scheduler).toContain('BGProcessingTaskRequest(identifier: processingIdentifier)');
    expect(scheduler).toContain('request.strategy = .queue');
    expect(scheduler).toContain('request.requiredResources = []');
    expect(scheduler).toContain('request.requiresNetworkConnectivity');
    expect(scheduler).toContain('request.requiresExternalPower');
    expect(scheduler).toContain('task.expirationHandler');
    expect(scheduler).toContain('task.progress.completedUnitCount');
    expect(scheduler).toContain('task.setTaskCompleted(success: false)');
    expect(scheduler).toContain('for identifier in identifiers');
    expect(scheduler).not.toContain('allSatisfy(registerContinuedHandler)');
    expect(scheduler).toContain('DispatchQueue.main.sync');
    expect(entitlements).not.toContain(
      'com.apple.developer.background-tasks.continued-processing.gpu',
    );
  });

  it('keeps platform wake non-authoritative and reconciles missing queued work', () => {
    const runtime = readIOSFile('Kavi/DurableExecution/IOSDurableExecutionRuntime.swift');
    const adapter = readIOSFile(
      'LocalPackages/KaviDurableExecutionCore/Sources/KaviDurableExecutionCore/IOSDurableExecutionAdapter.swift',
    );
    const coreContract = readIOSFile(
      'LocalPackages/KaviDurableExecutionCore/Sources/KaviDurableExecutionCore/IOSDurableExecutionContract.swift',
    );
    expect(runtime).toContain('pendingOrActiveTaskIdentifiers');
    expect(adapter).toContain('failureReason: .platformRequestMissing');
    expect(runtime).toContain('replayPendingRecoveryEvents()');
    expect(runtime).toContain('case requireUserAction = "require_user_action"');
    expect(coreContract).toContain('requiresFreshRecoveryQuery');
    expect(runtime).not.toContain('coordinateExecutionRecovery');
  });

  it('wires the native module and testable core package into the app target', () => {
    const project = readIOSFile('Kavi.xcodeproj/project.pbxproj');
    for (const source of [
      'IOSBackgroundTaskScheduler.swift in Sources',
      'IOSDurableExecutionRuntime.swift in Sources',
      'IOSDurableBridgeCodec.swift in Sources',
      'KaviDurableExecution.swift in Sources',
      'KaviDurableExecution.m in Sources',
    ]) {
      expect(project).toContain(source);
    }
    expect(project).toContain('relativePath = LocalPackages/KaviDurableExecutionCore;');
    expect(project).toContain('KaviDurableExecutionCore in Frameworks');
  });

  it('exports progress, checkpoint, cancellation, reconciliation, and retention methods', () => {
    const bridge = readIOSFile('Kavi/KaviDurableExecution.m');
    for (const method of [
      'enqueue:',
      'cancel:',
      'reportProgress:',
      'checkpoint:',
      'complete:',
      'scheduleRetry:',
      'block:',
      'releaseTerminal:',
      'getRecord:',
      'getPendingLaunches:',
      'reconcileOutboxes:',
    ]) {
      expect(bridge).toContain(`RCT_EXTERN_METHOD(${method}`);
    }
  });
});
