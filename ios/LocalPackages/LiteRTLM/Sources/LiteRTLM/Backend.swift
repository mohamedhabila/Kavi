public enum Backend: Equatable {
  case cpu(threadCount: Int? = nil)
  case gpu

  public var rawValue: String {
    switch self {
    case .cpu:
      return "cpu"
    case .gpu:
      return "gpu"
    }
  }

  public init?(rawValue: String) {
    switch rawValue {
    case "cpu":
      self = .cpu()
    case "gpu":
      self = .gpu
    default:
      return nil
    }
  }
}
