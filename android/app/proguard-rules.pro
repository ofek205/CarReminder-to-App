# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Keep line numbers for readable stack traces, but drop the real source
# file name from them (upload build/outputs/mapping/release/mapping.txt to
# Play Console to get those line numbers deobfuscated back to real
# file:line — see android-play-release.yml's Upload to Google Play step).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# capacitor-android already ships this exact rule as a consumer proguard
# rule, so it should apply on its own — kept here explicitly too, since
# TripGuardPlugin (registered in MainActivity, exposes the child-in-car
# reminder to JS) is reached by Capacitor's bridge via these annotations
# through reflection, and a missed keep rule here fails silently in the
# app rather than at build time.
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.PluginMethod public <methods>;
}

# The two TripGuard BroadcastReceivers are declared by name in
# AndroidManifest.xml, so AGP's default proguard-android.txt already keeps
# them; this is belt-and-suspenders for the whole package in case a class
# in it is ever reached only through Capacitor's JS bridge instead.
-keep class com.carreminder.app.tripguard.** { *; }

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}
