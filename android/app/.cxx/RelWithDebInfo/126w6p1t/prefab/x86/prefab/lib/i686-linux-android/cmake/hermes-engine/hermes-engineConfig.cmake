if(NOT TARGET hermes-engine::hermesvm)
add_library(hermes-engine::hermesvm SHARED IMPORTED)
set_target_properties(hermes-engine::hermesvm PROPERTIES
    IMPORTED_LOCATION "C:/Users/USER/.gradle/caches/8.13/transforms/d32e7a366cf1c517c42eb08289312d8e/transformed/hermes-android-250829098.0.9-release/prefab/modules/hermesvm/libs/android.x86/libhermesvm.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/USER/.gradle/caches/8.13/transforms/d32e7a366cf1c517c42eb08289312d8e/transformed/hermes-android-250829098.0.9-release/prefab/modules/hermesvm/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

