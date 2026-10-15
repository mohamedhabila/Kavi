#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(KaviLaunchRequests, RCTEventEmitter)

RCT_EXTERN_METHOD(consumePendingLaunchRequest:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

@end
