#!/bin/sh
# 建置兩個 WAR：
#   dist/quiz.war          → Tomcat 10 / 11（jakarta）
#   dist/tomcat9/quiz.war  → Tomcat 8.5 / 9（javax）
# 需要 JDK 11 以上，以及 Tomcat 的 servlet-api.jar、websocket-api.jar（放在 lib-tomcat9/、lib-tomcat10/ 或用環境變數指定）
set -e
cd "$(dirname "$0")"
T9=${T9_LIB:-lib-tomcat9}
T10=${T10_LIB:-lib-tomcat10}
GSON=gson-2.10.1.jar
rm -rf build dist && mkdir -p build dist/tomcat9

make_war() { # $1=variant $2=srcdir $3=classpath $4=release $5=webxml $6=out
  out=build/$1
  mkdir -p $out/WEB-INF/classes $out/WEB-INF/lib
  cp -R webapp/. $out/
  cp "$5" $out/WEB-INF/web.xml
  cp $GSON $out/WEB-INF/lib/
  javac -encoding UTF-8 --release $4 -nowarn -cp "$3:$GSON" -d $out/WEB-INF/classes $(find $2 -name '*.java')
  (cd $out && jar cf "$OLDPWD/$6" .)
}

# Tomcat 9（javax）
make_war t9 src "$T9/servlet-api.jar:$T9/websocket-api.jar" 8 web-javax.xml dist/tomcat9/quiz.war

# Tomcat 10/11（jakarta）：同一份原始碼，只換套件名稱
mkdir -p build/src-jakarta
cp -R src/. build/src-jakarta/
find build/src-jakarta -name '*.java' -exec sed -i 's/javax\.servlet/jakarta.servlet/g; s/javax\.websocket/jakarta.websocket/g' {} +
make_war t10 build/src-jakarta "$T10/servlet-api.jar:$T10/websocket-api.jar:$T10/websocket-client-api.jar" 11 web-jakarta.xml dist/quiz.war

echo "完成：dist/quiz.war（Tomcat 10/11）、dist/tomcat9/quiz.war（Tomcat 8.5/9）"
