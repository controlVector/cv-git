AC_PREREQ([2.69])
AC_INIT([TestProject], [1.0.0], [test@example.com])
AM_INIT_AUTOMAKE([foreign])

AC_PROG_CC
AC_PROG_CXX

# Check for libraries
AC_CHECK_LIB([ssl], [SSL_new])
AC_CHECK_LIB([crypto], [CRYPTO_new_ex_data])
AC_SEARCH_LIBS([pthread_create], [pthread])

# Check for headers
AC_CHECK_HEADER([openssl/ssl.h])
AC_CHECK_HEADERS([zlib.h bzlib.h lzma.h])

# pkg-config modules
PKG_CHECK_MODULES([GLIB], [glib-2.0 >= 2.50])
PKG_CHECK_MODULES([GIO], [gio-2.0])
PKG_CHECK_MODULES([CURL], [libcurl >= 7.58.0])

# Check for programs
AC_CHECK_PROG([PYTHON], [python3], [python3])
AC_PATH_PROG([PKG_CONFIG], [pkg-config])

AC_OUTPUT
