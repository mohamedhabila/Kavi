package com.kavi.mobile.localllm

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType

internal fun readableMapToAnyMap(readableMap: ReadableMap?): Map<String, Any?> {
  if (readableMap == null) {
    return emptyMap()
  }

  val result = linkedMapOf<String, Any?>()
  val iterator = readableMap.keySetIterator()
  while (iterator.hasNextKey()) {
    val key = iterator.nextKey()
    result[key] = readableValueToAny(readableMap, key)
  }
  return result
}

internal fun readableArrayToAnyList(readableArray: ReadableArray?): List<Any?> {
  if (readableArray == null) {
    return emptyList()
  }

  val result = mutableListOf<Any?>()
  for (index in 0 until readableArray.size()) {
    result.add(
      when (readableArray.getType(index)) {
        ReadableType.Null -> null
        ReadableType.Boolean -> readableArray.getBoolean(index)
        ReadableType.Number -> readableNumberToAny(readableArray.getDouble(index))
        ReadableType.String -> readableArray.getString(index)
        ReadableType.Map -> readableMapToAnyMap(readableArray.getMap(index))
        ReadableType.Array -> readableArrayToAnyList(readableArray.getArray(index))
      },
    )
  }
  return result
}

internal fun readableValueToAny(readableMap: ReadableMap, key: String): Any? {
  return when (readableMap.getType(key)) {
    ReadableType.Null -> null
    ReadableType.Boolean -> readableMap.getBoolean(key)
    ReadableType.Number -> readableNumberToAny(readableMap.getDouble(key))
    ReadableType.String -> readableMap.getString(key)
    ReadableType.Map -> readableMapToAnyMap(readableMap.getMap(key))
    ReadableType.Array -> readableArrayToAnyList(readableMap.getArray(key))
  }
}

private fun readableNumberToAny(value: Double): Any {
  return if (value % 1.0 == 0.0 && value in Int.MIN_VALUE.toDouble()..Int.MAX_VALUE.toDouble()) {
    value.toInt()
  } else {
    value
  }
}
