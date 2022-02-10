# Set up build
FROM node:lts@sha256:fd86131ddf8e0faa8ba7a3e49b6bf571745946e663e4065f3bff0a07204c1dde AS build
WORKDIR /usr/local/src/skill
COPY . ./

RUN npm ci --no-optional && \
    npm run compile && \
    rm -rf .git node_modules

FROM node:lts@sha256:2033f4cc18f9d8b5d0baa7f276aaeffd202e1a2c6fe9af408af05a34fe68cbfb
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
