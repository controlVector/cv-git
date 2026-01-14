project('test-project', 'c', 'cpp',
  version: '1.0.0',
  meson_version: '>=0.55.0')

# Required dependencies
glib_dep = dependency('glib-2.0', required: true, version: '>=2.50')
gio_dep = dependency('gio-2.0', required: true)
openssl_dep = dependency('openssl', required: true)

# Optional dependencies
curl_dep = dependency('libcurl', required: false)
zlib_dep = dependency('zlib', required: false)

# Find libraries
cc = meson.get_compiler('c')
m_lib = cc.find_library('m', required: false)
dl_lib = cc.find_library('dl', required: true)
custom_lib = cc.find_library('customlib', required: false)

# Find programs
python = find_program('python3', required: true)
doxygen = find_program('doxygen', required: false)
