export interface BucketTakeResult {
  granted: boolean;
  waitedMs: number;
  remaining: number;
}

export interface BucketConfig {
  capacity: number;
  refillPerSecond: number;
}
