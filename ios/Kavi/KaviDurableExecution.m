#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(KaviDurableExecution, RCTEventEmitter)

RCT_EXTERN_METHOD(enqueue:(NSDictionary *)request resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(cancel:(NSDictionary *)pointer updatedAtMillis:(nonnull NSNumber *)updatedAtMillis resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(reportProgress:(NSDictionary *)pointer completed:(nonnull NSNumber *)completed total:(nonnull NSNumber *)total updatedAtMillis:(nonnull NSNumber *)updatedAtMillis resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(checkpoint:(NSDictionary *)pointer nextIdentity:(NSDictionary *)nextIdentity updatedAtMillis:(nonnull NSNumber *)updatedAtMillis resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(complete:(NSDictionary *)pointer receiptDigest:(NSString *)receiptDigest updatedAtMillis:(nonnull NSNumber *)updatedAtMillis resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(scheduleRetry:(NSDictionary *)pointer nextAttemptAtMillis:(nonnull NSNumber *)nextAttemptAtMillis failureReason:(NSString *)failureReason updatedAtMillis:(nonnull NSNumber *)updatedAtMillis resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(block:(NSDictionary *)pointer failureReason:(NSString *)failureReason updatedAtMillis:(nonnull NSNumber *)updatedAtMillis resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(releaseTerminal:(NSDictionary *)pointer resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getRecord:(NSString *)runId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getPendingLaunches:(nonnull NSNumber *)limit resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(reconcileOutboxes:(nonnull NSNumber *)limit resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

@end
