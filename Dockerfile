# Set up build
FROM node:lts@sha256:ab6c8cd32006f8a4c1c795e55ddfbc7f54f5a3fb7318506ecb355cab8f5e7182 AS build
WORKDIR /usr/local/src/skill
COPY . ./

RUN npm ci --no-optional && \
    npm run compile && \
    rm -rf .git node_modules

FROM node:lts@sha256:ab6c8cd32006f8a4c1c795e55ddfbc7f54f5a3fb7318506ecb355cab8f5e7182
WORKDIR "/skill"
COPY package.json package-lock.json ./
RUN npm ci --no-optional \
    && npm cache clean --force \
    && git clone https://github.com/tfutils/tfenv.git ~/.tfenv \
    && ln -s ~/.tfenv/bin/* /usr/local/bin \
    && tfenv install 0.12.26\
    && tfenv use

COPY --from=build /usr/local/src/skill .
WORKDIR "/atm/home"
ENTRYPOINT ["node", "--no-deprecation", "--trace-warnings", "--expose_gc", "--optimize_for_size", "--always_compact", "--max_old_space_size=2048", "/skill/node_modules/.bin/atm-skill"]
CMD ["run"]
