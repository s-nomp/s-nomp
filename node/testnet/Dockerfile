FROM ubuntu:xenial

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    libzmq3-dev \
    make \
    python \
    software-properties-common \
    build-essential \
    libssl-dev \
    pkg-config \
    libc6-dev \
    m4 \
    g++-multilib \
    autoconf \
    libtool \
    ncurses-dev \
    unzip \
    git \
    python-zmq \
    zlib1g-dev \
    wget \
    curl \
    bsdmainutils \
    automake \
    libminiupnpc-dev \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/Arrowchain/arrow.git
WORKDIR /arrow
RUN git checkout arrow-1927 && \
  ./zcutil/fetch-params.sh

ARG ARROW_VERSION=1.0.0-rc1

RUN mkdir -p /arrow-bins
WORKDIR /arrow-bins
RUN wget -qO- https://github.com/Arrowchain/arrow/releases/download/${ARROW_VERSION}/arrow-v${ARROW_VERSION}-xenial.tar.gz | tar xvz -C /arrow-bins
RUN chmod +x /arrow-bins/arrowd
RUN chmod +x /arrow-bins/arrow-cli
RUN ln -sf /arrow-bins/arrowd /usr/bin/arrowd
RUN ln -sf /arrow-bins/arrow-cli /usr/bin/arrow-cli

RUN mkdir -p /arrow-conf
COPY arrow.conf /arrow-conf/arrow.conf

#PORT 7654 is P2P, 6543 is RPC
EXPOSE 7654 6543

VOLUME /root/.arrow

# CMD tail -f /dev/null
ENTRYPOINT ["arrowd", "-conf=/arrow-conf/arrow.conf"]
